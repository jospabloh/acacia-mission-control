// Server-only Supabase client using the service_role key (bypasses RLS).
// NEVER import this from src/ — it must never reach the browser bundle.
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  // Fail loud at cold start rather than silently no-op'ing every query.
  console.warn('[supabaseAdmin] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
}

export const supabaseAdmin = createClient(url ?? '', serviceKey ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Append a row to the audit log. Best-effort: never throw into the caller.
export async function audit(action, fields = {}) {
  try {
    await supabaseAdmin.from('audit_actions').insert({ action, ...fields })
  } catch (err) {
    console.error('[audit] failed', action, err?.message)
  }
}
