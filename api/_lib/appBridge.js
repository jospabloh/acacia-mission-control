// Calls an app's `acaciaControl` Base44 function over an HMAC-signed body.
// One uniform channel for read AND write (sync today, control in Fase 6).
// No OAuth tokens / passwords: the only shared secret is INGEST_HMAC_SECRET,
// stored here (Vercel) and in each Base44 app's secrets.
import { createClient } from '@base44/sdk'
import { signFor } from './ingestSign.js'

const BRIDGE_FN = 'acaciaControl'

export function bridgeConfigured() {
  return Boolean(process.env.INGEST_HMAC_SECRET)
}

// Invoke acaciaControl(action, params) on the app. Returns the function's JSON.
export async function callBridge(app, action, params = {}) {
  const secret = process.env.INGEST_HMAC_SECRET
  if (!secret) throw new Error('INGEST_HMAC_SECRET not set')

  // Canonicalize params exactly as they'll be transmitted: JSON drops `undefined`
  // keys, so we must sign the cleaned object — otherwise the bridge re-computes a
  // different string and rejects the signature (e.g. license.set with no `log`).
  const clean = JSON.parse(JSON.stringify(params ?? {}))
  const ts = Date.now().toString()
  // Signed with THIS app's derived key — nothing else. The temporary fallback
  // to the master is gone, deleted in the same pass that set
  // ACCEPT_LEGACY_MASTER to false: with the flag off, an app whose
  // ACACIA_APP_SLUG is missing or misspelled must FAIL here, not quietly keep
  // working on the shared key. That degradation was the hole.
  //
  // It was safe to delete because the fallback was measured, not assumed: all
  // nine apps were synced one by one on 2026-08-24 and every call verified
  // derived on the first attempt — the fallback never fired once, and never
  // logged the warning it existed to emit.
  //
  // Note this direction was never the vulnerable one: MC picks the destination
  // by appId, not by signature, so it cannot be tricked into talking to the
  // wrong app. The hole was inbound, in verifyFrom.
  const sig = signFor({ master: secret, slug: app.id, ts, action, params: clean })

  const client = createClient({ appId: app.external_id, serverUrl: process.env.BASE44_SERVER_URL || undefined })
  try {
    // verify_jwt is enforced in-function via HMAC, so no user token is needed.
    return await client.functions.invoke(BRIDGE_FN, { action, params: clean, ts, sig })
  } catch (e) {
    // Surface the bridge's real error (it returns { error } with a 4xx/5xx),
    // not the opaque axios "Request failed with status code N".
    const message = e?.response?.data?.error || e?.message || 'bridge error'
    // A "bad signature" here now means one concrete thing: that app's
    // ACACIA_APP_SLUG is missing or is not exactly its Mission Control id.
    // Name the app so the log alone points at the secret to fix.
    console.error(`callBridge failed: app=${app.id} (${app.name ?? app.external_id}) action=${action} error=${message}`)
    throw new Error(message)
  }
}
