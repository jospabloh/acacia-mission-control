import { supabase } from './supabase.js'

// Call a Mission Control `api/control/*` endpoint as the signed-in operator. The
// server validates the JWT and the member's role (admin+). Throws on error.
async function postControl(path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('sesión no iniciada')
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `error ${res.status}`)
  return json
}

// Trigger an on-demand sync of one app's licenses and/or usage.
export function runSync(appId, kinds = ['licenses', 'usage']) {
  return postControl('/api/control/run-sync', { appId, kinds })
}

// Read follow-up email history for one tenant (read-only; no email is sent).
export function emailStatus(appId, tenantExternalId) {
  return postControl('/api/control/email-status', { appId, tenantExternalId })
}

// WRITE: change a tenant's license (reactivate | suspend | view_only | set_plan).
export function licenseAction(appId, licenseExternalId, op, plan) {
  return postControl('/api/control/license-action', { appId, licenseExternalId, op, plan })
}

// Read tenant recipient contacts for an app (for targeting comunicados).
export function listContacts(appId) {
  return postControl('/api/control/list-contacts', { appId })
}

// Send a comunicado (renewal | campaign | maintenance) to recipients. Customer-facing.
export function sendMessage(payload) {
  return postControl('/api/control/send-message', payload)
}

// Aggregated first-party web KPIs per path (Freeware/Sitios). Read-only.
export function webKpis() {
  return postControl('/api/web-kpis', {})
}
