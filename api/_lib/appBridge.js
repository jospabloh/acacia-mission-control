// Calls an app's `acaciaControl` Base44 function over an HMAC-signed body.
// One uniform channel for read AND write (sync today, control in Fase 6).
// No OAuth tokens / passwords: the only shared secret is INGEST_HMAC_SECRET,
// stored here (Vercel) and in each Base44 app's secrets.
import { createClient } from '@base44/sdk'
import { sign } from './ingestSign.js'

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
  // STILL SIGNED WITH THE MASTER, deliberately, and this is the one place in
  // the migration where the order is forced.
  //
  // Mission Control deploys automatically on merge; the nine apps deploy by
  // hand. So MC is always first. In this direction MC signs and the app
  // verifies — if MC started signing with the derived key before the apps
  // could accept it, every acaciaControl call would fail from the merge until
  // the last app was deployed: licences, tickets, usage and health for the
  // whole portfolio, dark. The inbound direction is safe either way because
  // MC's verifier accepts both (see verifyFrom).
  //
  // Nor is this direction where the vulnerability lives: MC picks the
  // destination by appId, not by signature, so it cannot be tricked into
  // talking to the wrong app. The hole is inbound — apps signing with a shared
  // key — and it closes when the apps sign derived and ACCEPT_LEGACY_MASTER
  // goes false.
  //
  // STEP 2, once all nine apps are deployed: swap this for
  //   signFor({ master: secret, slug: app.id, ts, action, params: clean })
  // and flip ACCEPT_LEGACY_MASTER to false here and in every app.
  const sig = sign({ secret, ts, action, params: clean })

  const client = createClient({ appId: app.external_id, serverUrl: process.env.BASE44_SERVER_URL || undefined })
  try {
    // verify_jwt is enforced in-function via HMAC, so no user token is needed.
    return await client.functions.invoke(BRIDGE_FN, { action, params: clean, ts, sig })
  } catch (e) {
    // Surface the bridge's real error (it returns { error } with a 4xx/5xx),
    // not the opaque axios "Request failed with status code N".
    const message = e?.response?.data?.error || e?.message || 'bridge error'
    // Errors like "bad signature" don't say which app — INGEST_HMAC_SECRET is one
    // shared value signed against N per-app functions, so any one of them can drift
    // independently. Log the app so Vercel logs alone can point at the culprit.
    console.error(`callBridge failed: app=${app.id} (${app.name ?? app.external_id}) action=${action} error=${message}`)
    throw new Error(message)
  }
}
