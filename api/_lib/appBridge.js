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

  const ts = Date.now().toString()
  const sig = sign({ secret, ts, action, params })

  const client = createClient({ appId: app.external_id, serverUrl: process.env.BASE44_SERVER_URL || undefined })
  // verify_jwt is enforced in-function via HMAC, so no user token is needed.
  return client.functions.invoke(BRIDGE_FN, { action, params, ts, sig })
}
