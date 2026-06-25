import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stableStringify, sign, verify } from './ingestSign.js'

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
