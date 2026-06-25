// Server-only Supabase client using the service_role key (bypasses RLS).
// NEVER import this from src/ — it must never reach the browser bundle.
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Configured only when both are present. supabase-js throws "supabaseUrl is
// required" if constructed with an empty url, which would crash the whole
// function at import — so build the client lazily and let handlers report a
// clean error instead.
export const supabaseConfigured = Boolean(url && serviceKey)

if (!supabaseConfigured) {
  console.warn('[supabaseAdmin] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
}

export const supabaseAdmin = supabaseConfigured
  ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

// Guard for handlers: returns false (and writes a 500) when unconfigured.
export function requireSupabase(res) {
  if (!supabaseConfigured) {
    res.status(500).json({ error: 'Supabase no configurado: define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en Vercel.' })
    return false
  }
  return true
}

// Append a row to the audit log. Best-effort: never throw into the caller.
export async function audit(action, fields = {}) {
  if (!supabaseAdmin) return
  try {
    await supabaseAdmin.from('audit_actions').insert({ action, ...fields })
  } catch (err) {
    console.error('[audit] failed', action, err?.message)
  }
}
