import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
  parseSignatureHeader, buildSignedManifest, verifyWebhookSignature, mapPaymentToEvent,
} from './mercadopago.js'

test('parseSignatureHeader splits ts/v1', () => {
  const p = parseSignatureHeader('ts=1700000000, v1=abc123')
  assert.equal(p.ts, '1700000000')
  assert.equal(p.v1, 'abc123')
})

test('buildSignedManifest lowercases alphanumeric ids', () => {
  assert.equal(buildSignedManifest({ dataId: 'AbC9', requestId: 'r1', ts: '10' }), 'id:abc9;request-id:r1;ts:10;')
})

test('verifyWebhookSignature accepts a correctly signed manifest', () => {
  const secret = 'whsec_test'
  const ts = '1700000000', requestId = 'req-1', dataId = '12345'
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex')
  assert.equal(verifyWebhookSignature({ signatureHeader: `ts=${ts},v1=${v1}`, requestId, dataId, secret }), true)
})

test('verifyWebhookSignature rejects a tampered signature / missing secret', () => {
  assert.equal(verifyWebhookSignature({ signatureHeader: 'ts=1,v1=deadbeef', requestId: 'r', dataId: '1', secret: 's' }), false)
  assert.equal(verifyWebhookSignature({ signatureHeader: 'ts=1,v1=deadbeef', requestId: 'r', dataId: '1', secret: '' }), false)
})

test('mapPaymentToEvent normalizes an approved payment', () => {
  const e = mapPaymentToEvent({
    id: 998, status: 'approved', transaction_amount: 499.5, currency_id: 'MXN',
    date_approved: '2026-06-01T10:00:00Z', external_reference: 'app:puntos;tenant:b1',
  })
  assert.equal(e.event_type, 'payment')
  assert.equal(e.amount_cents, 49950)
  assert.equal(e.currency, 'MXN')
  assert.equal(e.external_id, '998')
  assert.equal(e.app_id, 'puntos')
  assert.equal(e.tenant_external_id, 'b1')
})

test('mapPaymentToEvent maps refunds/chargebacks and missing fields', () => {
  assert.equal(mapPaymentToEvent({ id: 1, status: 'refunded', transaction_amount: -100 }).event_type, 'refund')
  assert.equal(mapPaymentToEvent({ id: 2, status: 'charged_back', transaction_amount: 50 }).event_type, 'chargeback')
  const e = mapPaymentToEvent({ id: 3 })
  assert.equal(e.amount_cents, 0)
  assert.equal(e.currency, 'MXN')
  assert.equal(e.app_id, null)
})
