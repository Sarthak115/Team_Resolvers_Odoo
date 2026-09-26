import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)?.trim();
export let configurationError = '';
export let supabase = null;
try {
  if (!url || !key) throw new Error('Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local, then restart the development server.');
  if (key.startsWith('sb_secret_')) throw new Error('Use a public anon/publishable key, never a secret or service-role key.');
  if (key.split('.').length === 3) {
    const payload = JSON.parse(atob(key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
    if (payload.role === 'service_role') throw new Error('Use a public anon key, never a service-role key.');
  }
  supabase = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
} catch (error) { configurationError = error.message; }
