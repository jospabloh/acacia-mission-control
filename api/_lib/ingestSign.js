// Shared HMAC signing for the Mission Control ↔ Base44 admin bridge.
// The signature travels INSIDE the request body (not headers), so it works
// uniformly through the Base44 SDK's functions.invoke and a bridge function's
// req.json(). Both sides must canonicalize params identically — hence the
// stable (key-sorted) stringify.
import crypto from 'node:crypto'

// Deterministic JSON: object keys sorted recursively so MC and the app produce
// the exact same string to sign/verify.
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

export function canonicalMessage(ts, action, params) {
  return `${ts}.${action}.${stableStringify(params ?? {})}`
}

export function sign({ secret, ts, action, params }) {
  return crypto.createHmac('sha256', secret).update(canonicalMessage(ts, action, params)).digest('hex')
}

export function verify({ secret, ts, action, params, sig, maxSkewMs = 300000, now = Date.now() }) {
  if (!secret || !ts || !sig) return false
  if (Math.abs(now - Number(ts)) > maxSkewMs) return false // replay window
  const expected = sign({ secret, ts, action, params })
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(String(sig), 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ── Per-app key derivation ────────────────────────────────────────────────
//
// CANONICAL SOURCE for this half: `jospabloh/acacia-app-standard` →
// `shared/bridge/acaciaSign.ts` is the Deno twin every app carries. The two
// implementations must agree byte for byte; `ingestSign.test.js` pins the same
// test vector on both sides, because a disagreement shows up only as "bad
// signature" at runtime and looks like a config problem, not a code one.
//
// `INGEST_HMAC_SECRET` is ONE value shared by the whole portfolio, so a
// signature made with it proves "someone holding the shared secret", never
// "this is app X" — which is exactly how a ticket could be pushed under
// another app's name (module-14 audit, 2026-08-23). Signing with a key derived
// from the master AND the app's slug makes a signature only valid for the app
// it claims to be.
const APP_KEY_PREFIX = 'acacia.app.v1.'

// FALSE since 2026-08-24, and that flip is what closed the cross-attribution
// hole. `verifyFrom` now accepts ONLY the app's derived key, so an inbound
// ticket signed with the bare master — which every app holds — is rejected
// instead of being written under whatever `app` its body claimed.
//
// While it was true, MC and the nine apps could deploy in any order without
// the bridge going dark. It was flipped once that was no longer needed: all
// nine were synced one by one on 2026-08-24 and every call verified derived on
// the first attempt, with no fallback. Keep this in sync with every app's
// `_acaciaSign.ts` (canonical: acacia-app-standard → shared/bridge/).
export const ACCEPT_LEGACY_MASTER = false

/** This app's bridge key. `slug` is `apps.id` in the bodega. */
export function deriveAppKey(master, slug) {
  return crypto.createHmac('sha256', master).update(`${APP_KEY_PREFIX}${slug}`).digest('hex')
}

/** Sign a body as Mission Control talking TO `slug`. */
export function signFor({ master, slug, ts, action, params }) {
  return sign({ secret: deriveAppKey(master, slug), ts, action, params })
}

/**
 * Verify a body that claims to come FROM `slug`. The slug is what selects the
 * key, so a payload naming another app is checked against that app's key and
 * fails unless the sender actually holds it.
 */
export function verifyFrom({ master, slug, ts, action, params, sig, maxSkewMs, now }) {
  if (!master || !slug) return false
  const args = { ts, action, params, sig, maxSkewMs, now }
  if (verify({ secret: deriveAppKey(master, slug), ...args })) return true
  return ACCEPT_LEGACY_MASTER ? verify({ secret: master, ...args }) : false
}

/** The bearer form, for endpoints with no body to sign (an app's `health`). */
export function bearerFor(master, slug) {
  return deriveAppKey(master, slug)
}
