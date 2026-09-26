const now = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
const ids = {};
const id = key => ids[key] ||= uuid();
const date = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0,10); };
function seed() {
  const created_at = now();
  const db = { profiles: [{id:id('manager'),full_name:'Alex Morgan',email:'alex@stocksense.demo',role:'manager',created_at}], categories:['Furniture','Raw Materials','Equipment'].map(name=>({id:id(name),name,created_at})), products:[], warehouses:[], locations:[], contacts:[], inventory_balances:[], inventory_operations:[], inventory_operation_items:[], stock_movements:[] };
  db.warehouses = [['WH','Main Warehouse','Bhubaneswar, Odisha'],['WH2','Secondary Warehouse','Cuttack, Odisha']].map(([short_code,name,address])=>({id:id(short_code),name,short_code,address,created_at}));
  db.locations = [['stock','WH/Stock','STOCK','WH','internal'],['rack','WH/Rack A','RACK-A','WH','internal'],['production','WH/Production','PROD','WH','internal'],['stock2','WH2/Stock','STOCK','WH2','internal'],['vendor','Vendor','VEN',null,'supplier'],['customer','Customer','CUS',null,'customer'],['adjustment','Inventory Adjustment','ADJ',null,'adjustment']].map(([key,name,short_code,wh,type])=>({id:id(key),warehouse_id:wh?id(wh):null,name,short_code,type,created_at}));
  db.products = [['Desk','FUR-001','Furniture',3000,15,'Units'],['Table','FUR-002','Furniture',5000,10,'Units'],['Office Chair','FUR-003','Furniture',2400,20,'Units'],['Steel Rod','RAW-001','Raw Materials',850,100,'Units'],['Storage Rack','EQP-001','Equipment',7200,8,'Units'],['Monitor Stand','EQP-002','Equipment',1200,12,'Units'],['Filing Cabinet','FUR-004','Furniture',6800,5,'Units'],['Packing Tape','EQP-003','Equipment',120,25,'Rolls']].map(([name,sku,cat,cost,minimum_stock,unit])=>({id:id(name),name,sku,category_id:id(cat),unit,cost,minimum_stock,created_at,updated_at:created_at}));
  db.contacts = [['Urban Furnishings','supplier','orders@urban.example','+91 674 250 1400','Bhubaneswar'],['Tata Steel Supplies','supplier','sales@tata.example','+91 657 242 5000','Jamshedpur'],['Azure Interiors','customer','hello@azure.example','+91 674 251 2200','Bhubaneswar'],['Nova Workspace','customer','team@nova.example','+91 671 240 1800','Cuttack']].map(([name,type,email,phone,address])=>({id:id(name),name,type,email,phone,address,created_at}));
  [['Desk','stock',50],['Desk','rack',12],['Table','stock',30],['Office Chair','stock',16],['Office Chair','stock2',8],['Steel Rod','stock',80],['Steel Rod','production',15],['Storage Rack','stock',6],['Monitor Stand','rack',24],['Filing Cabinet','stock',14],['Packing Tape','stock',100]].forEach(([p,l,q])=>db.inventory_balances.push({id:uuid(),product_id:id(p),location_id:id(l),quantity_on_hand:q,reserved_quantity:0,updated_at:created_at}));
  const add = (type,num,status,src,dst,contact,offset,lines) => {
    const op={id:uuid(),reference:`WH/${{receipt:'IN',delivery:'OUT',transfer:'INT',adjustment:'ADJ'}[type]}/${String(num).padStart(4,'0')}`,operation_type:type,status,warehouse_id:id('WH'),source_location_id:id(src),destination_location_id:id(dst),contact_id:contact?id(contact):null,scheduled_date:date(offset),responsible_user_id:id('manager'),notes:'',created_by:id('manager'),created_at,completed_at:status==='done'?new Date(date(offset)+'T10:30:00').toISOString():null};
    db.inventory_operations.push(op);
    lines.forEach(([p,q])=>{const item={id:uuid(),operation_id:op.id,product_id:id(p),requested_quantity:q,reserved_quantity:status==='ready'&&type==='delivery'?q:0,done_quantity:status==='done'?q:0,created_at};db.inventory_operation_items.push(item);if(item.reserved_quantity)db.inventory_balances.find(b=>b.product_id===id(p)&&b.location_id===id(src)).reserved_quantity+=q;if(status==='done')db.stock_movements.push({id:uuid(),operation_id:op.id,operation_item_id:item.id,product_id:item.product_id,source_location_id:type==='adjustment'?op.destination_location_id:op.source_location_id,destination_location_id:type==='adjustment'?op.source_location_id:op.destination_location_id,quantity:type==='adjustment'?5:q,movement_type:type,created_at:op.completed_at,created_by:id('manager')});});
  };
  add('receipt',1,'ready','vendor','stock','Urban Furnishings',-2,[['Desk',20],['Office Chair',40]]);
  add('receipt',2,'draft','vendor','stock','Tata Steel Supplies',2,[['Steel Rod',150]]);
  add('receipt',3,'done','vendor','stock','Urban Furnishings',-5,[['Table',30],['Storage Rack',6]]);
  add('receipt',4,'ready','vendor','rack','Urban Furnishings',0,[['Monitor Stand',12]]);
  add('delivery',1,'ready','stock','customer','Azure Interiors',-1,[['Desk',5],['Table',4]]);
  add('delivery',2,'waiting','stock','customer','Nova Workspace',0,[['Office Chair',30]]);
  add('delivery',3,'draft','stock','customer','Azure Interiors',3,[['Storage Rack',2]]);
  add('delivery',4,'done','stock','customer','Nova Workspace',-3,[['Desk',8],['Packing Tape',10]]);
  add('transfer',1,'done','stock','rack',null,-4,[['Desk',12]]);
  add('transfer',2,'draft','stock','stock2',null,1,[['Table',5]]);
  add('adjustment',1,'done','adjustment','stock',null,-2,[['Steel Rod',80]]);
  return db;
}
const KEY='stocksense-data-v1';
export let db;
try { db=JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db=seed(); }
// Keep adjustment headers consistent: virtual adjustment location -> counted location.
for (const op of db.inventory_operations) {
  if (op.operation_type === 'adjustment' && db.locations.find(l => l.id === op.destination_location_id)?.type === 'adjustment') {
    [op.source_location_id, op.destination_location_id] = [op.destination_location_id, op.source_location_id];
  }
}
export const persist=()=>localStorage.setItem(KEY,JSON.stringify(db));
persist();
export const get=(table,key)=>db[table].find(x=>x.id===key);
export const items=op=>db.inventory_operation_items.filter(i=>i.operation_id===op);
export function balance(product,location,create=false) { let b=db.inventory_balances.find(x=>x.product_id===product&&x.location_id===location);if(!b&&create){b={id:uuid(),product_id:product,location_id:location,quantity_on_hand:0,reserved_quantity:0,updated_at:now()};db.inventory_balances.push(b);}return b||{quantity_on_hand:0,reserved_quantity:0}; }
export function stock(product) {const bs=db.inventory_balances.filter(b=>b.product_id===product&&get('locations',b.location_id)?.type==='internal');const on=bs.reduce((n,b)=>n+b.quantity_on_hand,0),reserved=bs.reduce((n,b)=>n+b.reserved_quantity,0);return{on,reserved,free:on-reserved};}
export function saveProduct(data,existing) {
  if(!data.name||!data.sku||!data.unit||!get('categories',data.category_id))throw Error('Name, SKU, category and unit are required.');
  if([data.cost,data.minimum_stock,data.initial_stock].some(n=>!Number.isFinite(n)||n<0))throw Error('Cost and stock quantities must be valid nonnegative numbers.');
  if(!existing&&data.initial_stock>0&&get('locations',data.location_id)?.type!=='internal')throw Error('Choose an internal location for initial stock.');
  if(db.products.some(p=>p.sku.toLowerCase()===data.sku.toLowerCase()&&p.id!==existing))throw Error('A product with this SKU already exists.');
  const {initial_stock,location_id,...fields}=data;
  if(existing){Object.assign(get('products',existing),fields,{updated_at:now()});}else{const p={id:uuid(),...fields,created_at:now(),updated_at:now()};db.products.push(p);if(initial_stock>0){const op=saveOperation('adjustment',{source_location_id:idForType('adjustment'),destination_location_id:location_id,contact_id:null,scheduled_date:date(0),responsible_user_id:db.profiles[0].id,notes:'Initial stock'},[{product_id:p.id,requested_quantity:initial_stock}]);readyOperation(op.id);validateOperation(op.id);}existing=p.id;}persist();return existing;
}
export const idForType=type=>db.locations.find(l=>l.type===type)?.id;
function checkFields(type,fields,lines){
  if(!lines.length)throw Error('Add at least one product.');
  if(new Set(lines.map(l=>l.product_id)).size!==lines.length)throw Error('Use one row per product; combine duplicate quantities.');
  if(lines.some(l=>!get('products',l.product_id)||!Number.isFinite(l.requested_quantity)||l.requested_quantity<(type==='adjustment'?0:0.000001)))throw Error('Enter a valid quantity for each product.');
  const src=get('locations',fields.source_location_id),dst=get('locations',fields.destination_location_id);
  if(!src||!dst||src.id===dst.id)throw Error('Choose different source and destination locations.');
  if(type==='receipt'&&(src.type!=='supplier'||dst.type!=='internal')||type==='delivery'&&(src.type!=='internal'||dst.type!=='customer')||type==='transfer'&&(src.type!=='internal'||dst.type!=='internal')||type==='adjustment'&&(src.type!=='adjustment'||dst.type!=='internal'))throw Error('Select valid locations for this operation.');
  if(!fields.scheduled_date||!get('profiles',fields.responsible_user_id))throw Error('Scheduled date and responsible person are required.');
  if(['receipt','delivery'].includes(type)&&!get('contacts',fields.contact_id))throw Error('Choose a contact.');
}
export function saveOperation(type,fields,lines,existing){
  checkFields(type,fields,lines);
  let op=existing?get('inventory_operations',existing):null;
  if(op&&!['draft','waiting'].includes(op.status))throw Error('Only draft or waiting operations can be edited.');
  if(!op){const warehouse=get('locations',type==='receipt'||type==='adjustment'?fields.destination_location_id:fields.source_location_id)?.warehouse_id;const code=get('warehouses',warehouse)?.short_code||'WH';const prefix=`${code}/${{receipt:'IN',delivery:'OUT',transfer:'INT',adjustment:'ADJ'}[type]}/`;const next=Math.max(0,...db.inventory_operations.filter(o=>o.reference.startsWith(prefix)).map(o=>Number(o.reference.split('/').at(-1))))+1;op={id:uuid(),reference:prefix+String(next).padStart(4,'0'),operation_type:type,status:'draft',warehouse_id:warehouse,...fields,created_by:db.profiles[0].id,created_at:now(),completed_at:null};db.inventory_operations.push(op);}else{Object.assign(op,fields,{status:'draft',warehouse_id:get('locations',type==='receipt'||type==='adjustment'?fields.destination_location_id:fields.source_location_id).warehouse_id});db.inventory_operation_items=db.inventory_operation_items.filter(i=>i.operation_id!==op.id);}
  lines.forEach(line=>db.inventory_operation_items.push({id:uuid(),operation_id:op.id,product_id:line.product_id,requested_quantity:line.requested_quantity,reserved_quantity:0,done_quantity:0,created_at:now()}));persist();return op;
}
export function readyOperation(key){const op=get('inventory_operations',key);if(!op||!['draft','waiting'].includes(op.status))throw Error('This operation cannot be marked ready.');const ls=items(key);if(['delivery','transfer'].includes(op.operation_type)&&ls.some(i=>{const b=balance(i.product_id,op.source_location_id);return i.requested_quantity>b.quantity_on_hand-b.reserved_quantity;})){op.status='waiting';persist();return false;}
  if(op.operation_type==='delivery')ls.forEach(i=>{const b=balance(i.product_id,op.source_location_id,true);b.reserved_quantity+=i.requested_quantity;b.updated_at=now();i.reserved_quantity=i.requested_quantity;});op.status='ready';persist();return true;
}
export function cancelOperation(key){const op=get('inventory_operations',key);if(!op||['done','cancelled'].includes(op.status))throw Error('This operation is already closed.');items(key).forEach(i=>{if(i.reserved_quantity){const b=balance(i.product_id,op.source_location_id,true);b.reserved_quantity-=i.reserved_quantity;b.updated_at=now();i.reserved_quantity=0;}});op.status='cancelled';persist();}
export function validateOperation(key){const op=get('inventory_operations',key);if(!op||op.status!=='ready')throw Error('Mark the operation Ready before validating.');const ls=items(key),type=op.operation_type;
  for(const i of ls){const b=balance(i.product_id,op.source_location_id);if(['delivery','transfer'].includes(type)&&i.requested_quantity>b.quantity_on_hand-b.reserved_quantity+i.reserved_quantity)throw Error('Insufficient stock. Recheck availability after replenishment.');if(type==='adjustment'&&i.requested_quantity<balance(i.product_id,op.destination_location_id).reserved_quantity)throw Error('Physical count cannot be below reserved stock. Cancel the related delivery first.');}
  const stamp=now();ls.forEach(i=>{let src=op.source_location_id,dst=op.destination_location_id,q=i.requested_quantity;
    if(type==='adjustment'){const b=balance(i.product_id,dst,true),diff=q-b.quantity_on_hand;b.quantity_on_hand=q;b.updated_at=stamp;if(diff<0)[src,dst]=[dst,src];q=Math.abs(diff);}else{if(type!=='receipt'){const b=balance(i.product_id,src,true);b.quantity_on_hand-=q;b.reserved_quantity-=i.reserved_quantity;b.updated_at=stamp;}if(type!=='delivery'){const b=balance(i.product_id,dst,true);b.quantity_on_hand+=q;b.updated_at=stamp;}}
    i.done_quantity=i.requested_quantity;i.reserved_quantity=0;db.stock_movements.push({id:uuid(),operation_id:key,operation_item_id:i.id,product_id:i.product_id,source_location_id:src,destination_location_id:dst,quantity:q,movement_type:type,created_at:stamp,created_by:db.profiles[0].id});});op.status='done';op.completed_at=stamp;persist();
}
