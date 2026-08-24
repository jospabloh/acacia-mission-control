// Calls an app's `acaciaControl` Base44 function over an HMAC-signed body.
// One uniform channel for read AND write (sync today, control in Fase 6).
// No OAuth tokens / passwords: the only shared secret is INGEST_HMAC_SECRET,
// stored here (Vercel) and in each Base44 app's secrets.
import { createClient } from '@base44/sdk'
import { sign, signFor, ACCEPT_LEGACY_MASTER } from './ingestSign.js'

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
  // SIGNED WITH THIS APP'S DERIVED KEY, with one fallback to the master.
  //
  // All nine apps verify derived as of 2026-08-23, so the normal path is the
  // first attempt and the fallback never runs. It exists because MC cannot read
  // an app's Base44 secrets: if one app's ACACIA_APP_SLUG is missing or
  // misspelled, it derives a different key, and a plain switch to derived-only
  // signing would take that app's licences, tickets, usage and health dark with
  // no warning. Falling back keeps it alive and — the point — NAMES it in the
  // log, so the fix is a secret to correct rather than an outage to diagnose.
  //
  // The retry only fires on a signature rejection. Any other bridge error
  // (missing action, app-side 500) is returned as-is rather than doubled.
  //
  // This is not where the vulnerability lives: MC picks the destination by
  // appId, not by signature, so it cannot be tricked into talking to the wrong
  // app. The hole is inbound — apps signing with a shared key — and it closes
  // when ACCEPT_LEGACY_MASTER goes false everywhere. Delete this fallback in
  // the same pass: with the flag off, a wrong slug must fail, not degrade.
  const attempts = [{ how: 'derived', sig: signFor({ master: secret, slug: app.id, ts, action, params: clean }) }]
  if (ACCEPT_LEGACY_MASTER) attempts.push({ how: 'master', sig: sign({ secret, ts, action, params: clean }) })

  const client = createClient({ appId: app.external_id, serverUrl: process.env.BASE44_SERVER_URL || undefined })
  let lastMessage = 'bridge error'
  for (const [i, attempt] of attempts.entries()) {
    try {
      // verify_jwt is enforced in-function via HMAC, so no user token is needed.
      const out = await client.functions.invoke(BRIDGE_FN, { action, params: clean, ts, sig: attempt.sig })
      if (attempt.how === 'master') {
        console.warn(
          `callBridge: app=${app.id} rejected the derived key and accepted the master. ` +
          `Its ACACIA_APP_SLUG is missing or not "${app.id}". Fix that secret — once ` +
          `ACCEPT_LEGACY_MASTER goes false this call fails instead of falling back.`,
        )
      }
      return out
    } catch (e) {
      // Surface the bridge's real error (it returns { error } with a 4xx/5xx),
      // not the opaque axios "Request failed with status code N".
      lastMessage = e?.response?.data?.error || e?.message || 'bridge error'
      const isSignature = /signature/i.test(String(lastMessage))
      if (isSignature && i < attempts.length - 1) continue
      // Errors like "bad signature" don't say which app on their own, so log it.
      console.error(`callBridge failed: app=${app.id} (${app.name ?? app.external_id}) action=${action} signed=${attempt.how} error=${lastMessage}`)
      throw new Error(lastMessage)
    }
  }
  throw new Error(lastMessage)
}
