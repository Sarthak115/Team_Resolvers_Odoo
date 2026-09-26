import { supabase, configurationError } from './supabase.js';

const tables = ['profiles', 'categories', 'products', 'warehouses', 'locations', 'contacts',
  'inventory_balances', 'inventory_operations', 'inventory_operation_items', 'stock_movements',
  'product_stock_summary', 'dashboard_metrics'];
export const db = Object.fromEntries(tables.map(table => [table, []]));
export const authState = { session: null, profile: null, recovery: false };
export const availability = new Map();
let loadVersion = 0;

function client() {
  if (!supabase) throw new Error(configurationError);
  return supabase;
}
function checked(result, context) {
  if (result.error) {
    const { code, message } = result.error;
    if (code === '23505') throw new Error(`${context}: this record already exists (check its SKU or short code).`);
    if (code === '42501') throw new Error(`${context}: your account does not have access. Check the existing RLS policies.`);
    throw new Error(`${context}: ${message}`);
  }
  return result.data;
}
export const get = (table, key) => db[table].find(row => row.id === key);
export const items = operation => db.inventory_operation_items.filter(item => item.operation_id === operation);
export const idForType = type => db.locations.find(location => location.type === type)?.id;
export const currentProfile = () => authState.profile;
export const metrics = () => db.dashboard_metrics[0] || {};
export const balance = (product, location) => db.inventory_balances.find(row =>
  row.product_id === product && row.location_id === location) || { quantity_on_hand: 0, reserved_quantity: 0 };
export function stock(product) {
  const row = db.product_stock_summary.find(row => row.product_id === product);
  return { on: Number(row?.quantity_on_hand ?? 0), reserved: Number(row?.reserved_quantity ?? 0),
    free: Number(row?.free_to_use ?? 0) };
}
function clearData() {
  loadVersion++;
  tables.forEach(table => { db[table] = []; });
  availability.clear();
  authState.profile = null;
}
// Page through all records rather than silently truncating at the PostgREST row limit.
async function readTable(table) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    let query = client().from(table).select('*');
    if (table === 'product_stock_summary') query = query.order('product_id');
    else if (table !== 'dashboard_metrics') query = query.order('id');
    const page = checked(await query.range(offset, offset + 999), `Could not load ${table.replaceAll('_', ' ')}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
export async function refreshData() {
  if (!authState.session) { clearData(); return; }
  const version = ++loadVersion;
  const userId = authState.session.user.id;
  const results = await Promise.allSettled(tables.map(readTable));
  if (version !== loadVersion || authState.session?.user.id !== userId) return;
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  tables.forEach((table, index) => { db[table] = results[index].value; });
  authState.profile = db.profiles.find(profile => profile.id === userId) || null;
  availability.clear();
  if (!authState.profile) throw new Error('Your profile is not available. Check the existing profile trigger and profiles read policy.');
}
export async function initializeSession() {
  const { session } = checked(await client().auth.getSession(), 'Could not restore session');
  authState.session = session;
  if (session) await refreshData();
}
// The callback holds the Auth lock: run dependent requests after it returns.
if (supabase) supabase.auth.onAuthStateChange((event, session) => {
  const changedUser = authState.session?.user.id !== session?.user.id;
  authState.session = session;
  if (event === 'PASSWORD_RECOVERY') authState.recovery = true;
  if (!session || changedUser) clearData();
  if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
  if (changedUser || event === 'PASSWORD_RECOVERY' || event === 'SIGNED_OUT') {
    setTimeout(() => window.dispatchEvent(new CustomEvent('stocksense-session', { detail: event })), 0);
  }
});
export async function signIn(email, password) {
  const data = checked(await client().auth.signInWithPassword({ email, password }), 'Sign in failed');
  authState.session = data.session;
  await refreshData();
}
export async function signUp(fullName, email, password) {
  const data = checked(await client().auth.signUp({ email, password,
    options: { data: { full_name: fullName }, emailRedirectTo: `${location.origin}/dashboard` } }), 'Sign up failed');
  authState.session = data.session;
  if (data.session) await refreshData();
  return !!data.session;
}
export async function signOut() {
  checked(await client().auth.signOut(), 'Sign out failed');
  authState.session = null;
  authState.recovery = false;
  clearData();
}
export async function requestPasswordReset(email) {
  checked(await client().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` }), 'Password reset failed');
}
export async function resetPassword(password) {
  if (!authState.session) throw new Error('Open a valid password reset link from your email first.');
  checked(await client().auth.updateUser({ password }), 'Could not update password');
  authState.recovery = false;
  await refreshData();
}
async function refreshAfterMutation() {
  try { await refreshData(); }
  catch (error) {
    // A successful write must not be retried just because its refresh failed.
    window.dispatchEvent(new CustomEvent('stocksense-refresh-error', { detail: error.message }));
  }
}
export async function loadAvailability(productId, locationId) {
  if (!productId || !locationId) return;
  const value = checked(await client().rpc('get_free_stock', { product_id: productId, location_id: locationId }), 'Could not check available stock');
  if (value === null || !Number.isFinite(Number(value))) throw new Error('The free-stock function did not return a quantity.');
  availability.set(`${productId}:${locationId}`, Number(value));
  return Number(value);
}
export async function saveProduct(data, existing) {
  const { initial_stock = 0, location_id, ...fields } = data;
  if (!fields.name || !fields.sku || !fields.unit || !fields.category_id) throw new Error('Name, SKU, category and unit are required.');
  if ([fields.cost, fields.minimum_stock, fields.reorder_quantity, initial_stock].some(n => !Number.isFinite(n) || n < 0)) throw new Error('Cost and stock quantities must be nonnegative numbers.');
  if (!existing && initial_stock > 0 && get('locations', location_id)?.type !== 'internal') throw new Error('Choose an internal location for initial stock.');
  const query = existing ? client().from('products').update(fields).eq('id', existing) : client().from('products').insert(fields);
  const product = checked(await query.select().single(), 'Could not save product');
  let warning = null;
  if (!existing && initial_stock > 0) {
    try {
      const op = await saveOperation('adjustment', { source_location_id: idForType('adjustment'),
        destination_location_id: location_id, contact_id: null, scheduled_date: new Date().toISOString(),
        responsible_user_id: authState.session.user.id, notes: 'Initial stock' },
      [{ product_id: product.id, counted_quantity: initial_stock }]);
      await readyOperation(op.id);
      await validateOperation(op.id);
    } catch (error) { warning = `Product saved, but initial stock was not completed: ${error.message} Review Inventory Adjustments before retrying.`; }
  }
  await refreshAfterMutation();
  return { id: product.id, warning };
}
export async function saveSetting(kind, fields) {
  if (!['warehouses', 'locations'].includes(kind)) throw new Error('Invalid settings type.');
  if (!fields.name || !fields.short_code) throw new Error('Name and short code are required.');
  if (kind === 'locations' && fields.type === 'internal' && !fields.warehouse_id) throw new Error('Internal locations require a warehouse.');
  checked(await client().from(kind).insert(fields).select().single(), 'Could not save '+kind.slice(0, -1));
  await refreshAfterMutation();
}
function checkOperation(type, fields, lines) {
  if (!authState.session || !authState.profile) throw new Error('Sign in with an inventory profile first.');
  if (!lines.length) throw new Error('Add at least one product.');
  if (new Set(lines.map(line => line.product_id)).size !== lines.length) throw new Error('Use one row per product; combine duplicate quantities.');
  for (const line of lines) {
    const quantity = type === 'adjustment' ? line.counted_quantity : line.requested_quantity;
    if (!line.product_id || !Number.isFinite(quantity) || quantity < 0 || (type !== 'adjustment' && quantity === 0)) throw new Error('Enter a valid quantity for each product.');
  }
  const src = get('locations', fields.source_location_id), dst = get('locations', fields.destination_location_id);
  if (!src || !dst || src.id === dst.id) throw new Error('Choose different source and destination locations.');
  const allowed = { receipt: ['supplier', 'internal'], delivery: ['internal', 'customer'], transfer: ['internal', 'internal'], adjustment: ['adjustment', 'internal'] }[type];
  if (!allowed || src.type !== allowed[0] || dst.type !== allowed[1]) throw new Error('Select valid locations for this operation.');
  if (!fields.scheduled_date || !fields.responsible_user_id) throw new Error('Scheduled date and responsible person are required.');
  if (['receipt', 'delivery'].includes(type) && !fields.contact_id) throw new Error('Choose a contact.');
}
export async function saveOperation(type, fields, lines, existing) {
  checkOperation(type, fields, lines);
  let operationId = existing;
  const warehouseId = get('locations', ['receipt', 'adjustment'].includes(type) ? fields.destination_location_id : fields.source_location_id).warehouse_id;
  const payload = { ...fields, warehouse_id: warehouseId };
  let oldItems = [];
  if (existing) {
    const current = checked(await client().from('inventory_operations').select('*').eq('id', existing).single(), 'Could not load operation');
    if (!['draft', 'waiting'].includes(current.status)) throw new Error('Only draft or waiting operations can be edited. Reload to see its current status.');
    oldItems = checked(await client().from('inventory_operation_items').select('*').eq('operation_id', existing), 'Could not load product lines');
    if (oldItems.some(item => Number(item.reserved_quantity) > 0)) throw new Error('This operation has reserved stock. Cancel it before changing its lines.');
    checked(await client().from('inventory_operations').update(payload).eq('id', existing).in('status', ['draft', 'waiting']).select().single(), 'Could not save operation');
  } else {
    // Reference and timestamps are owned by the database, never generated here.
    const created = checked(await client().from('inventory_operations').insert({ ...payload,
      operation_type: type, status: 'draft', created_by: authState.session.user.id }).select().single(), 'Could not create operation');
    operationId = created.id;
  }
  try {
    const rows = lines.map(line => {
      const old = oldItems.find(item => item.product_id === line.product_id);
      return { ...(old ? { id: old.id } : {}), operation_id: operationId, product_id: line.product_id,
        ...(type === 'adjustment' ? { counted_quantity: line.counted_quantity } : { requested_quantity: line.requested_quantity }) };
    });
    checked(await client().from('inventory_operation_items').upsert(rows, { onConflict: 'id', defaultToNull: false }).select(), 'Could not save product lines');
    const removed = oldItems.filter(item => !lines.some(line => line.product_id === item.product_id)).map(item => item.id);
    if (removed.length) checked(await client().from('inventory_operation_items').delete().eq('operation_id', operationId).in('id', removed), 'Could not remove product lines');
  } catch (error) {
    error.operationId = operationId;
    error.message = `Operation saved, but its product lines need attention. ${error.message} Save again before preparing.`;
    throw error;
  }
  let operation;
  try {
    operation = checked(await client().from('inventory_operations').select('*').eq('id', operationId).single(), 'Operation saved but could not reload it');
  } catch (error) { error.operationId = operationId; throw error; }
  await refreshAfterMutation();
  return operation;
}
async function operationRpc(name, operationId) {
  checked(await client().rpc(name, { operation_id: operationId }), 'Operation failed');
  await refreshAfterMutation();
  return checked(await client().from('inventory_operations').select('*').eq('id', operationId).single(), 'Operation updated but could not reload its status');
}
export async function readyOperation(operationId) {
  const operation = await operationRpc('prepare_operation', operationId);
  return operation.status === 'ready';
}
export const validateOperation = operationId => operationRpc('validate_operation', operationId);
export const cancelOperation = operationId => operationRpc('cancel_operation', operationId);
