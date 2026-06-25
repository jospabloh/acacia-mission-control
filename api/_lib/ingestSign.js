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
