import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stableStringify, sign, verify, deriveAppKey, signFor, verifyFrom, bearerFor } from './ingestSign.js'

test('stableStringify is key-order independent', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }))
  assert.equal(stableStringify({ a: { y: 1, x: 2 } }), '{"a":{"x":2,"y":1}}')
})

test('sign/verify round-trips with the same secret', () => {
  const args = { secret: 's3cr3t', ts: '1700000000000', action: 'licenses.list', params: { entity: 'Business' } }
  const sig = sign(args)
  assert.equal(verify({ ...args, sig, now: 1700000000000 }), true)
})

test('verify is order-independent on params', () => {
  const secret = 's', ts = '1700000000000', action = 'a'
  const sig = sign({ secret, ts, action, params: { a: 1, b: 2 } })
  assert.equal(verify({ secret, ts, action, params: { b: 2, a: 1 }, sig, now: 1700000000000 }), true)
})

test('verify rejects tampering, wrong secret, and stale timestamps', () => {
  const base = { secret: 's', ts: '1700000000000', action: 'a', params: { x: 1 } }
  const sig = sign(base)
  assert.equal(verify({ ...base, sig, params: { x: 2 }, now: 1700000000000 }), false) // tampered params
  assert.equal(verify({ ...base, sig, secret: 'other', now: 1700000000000 }), false)  // wrong secret
  assert.equal(verify({ ...base, sig, now: 1700000000000 + 600000 }), false)          // 10 min skew
  assert.equal(verify({ ...base, sig: 'deadbeef', now: 1700000000000 }), false)       // bad sig
})

// ── Per-app key derivation ────────────────────────────────────────────────
// The vector below is duplicated verbatim in acacia-app-standard's
// `shared/bridge/acaciaSign.ts`, which every app carries as a Deno twin. Two
// implementations of the same HMAC in two runtimes only stay equal if
// something asserts it: a drift here surfaces at runtime as "bad signature"
// on every bridge call, which reads like a misconfigured secret rather than a
// code change, and would cost hours to trace.
test('deriveAppKey matches the vector the apps pin', () => {
  assert.equal(
    deriveAppKey('test-master', 'puntos'),
    'b22a11d857d2f7b72ad625d5dfbf08458699a7e972ecb5230285c8cfe40268ec',
  )
  assert.equal(
    deriveAppKey('test-master', 'liuma'),
    'cdfd05669dd3d27ea3841af7bc0c2f19780a854e954fdc75640a5a681cab78d0',
  )
})

test('a key derived for one app differs from another app', () => {
  assert.notEqual(deriveAppKey('m', 'puntos'), deriveAppKey('m', 'liuma'))
})

test('signFor/verifyFrom round-trip for the same slug', () => {
  const args = { ts: Date.now(), action: 'ticket.ingest', params: { a: 1 } }
  const sig = signFor({ master: 'm', slug: 'puntos', ...args })
  assert.equal(verifyFrom({ master: 'm', slug: 'puntos', ...args, sig }), true)
})

// The whole point of the change: a body signed by one app and relabelled as
// another must not verify. With ACCEPT_LEGACY_MASTER still true this passes
// only because the signature was made with a DERIVED key — a legacy signature
// made with the bare master would still be accepted for any slug, which is
// why the flip to false is what actually closes the hole.
test('a signature from one app does not verify as another', () => {
  const args = { ts: Date.now(), action: 'ticket.ingest', params: { a: 1 } }
  const sig = signFor({ master: 'm', slug: 'puntos', ...args })
  assert.equal(verifyFrom({ master: 'm', slug: 'liuma', ...args, sig }), false)
})

test('bearerFor is the derived key, so health differs per app', () => {
  assert.equal(bearerFor('m', 'ctrlhq'), deriveAppKey('m', 'ctrlhq'))
  assert.notEqual(bearerFor('m', 'ctrlhq'), bearerFor('m', 'kitchops'))
})
