import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertReportPayload } from './payment-report.js'

test('assertReportPayload: exige appId, licenseExternalId y amount positivo', () => {
  assert.equal(assertReportPayload({}).ok, false)
  assert.equal(assertReportPayload({ appId: 'stockflow', licenseExternalId: 'x' }).ok, false) // sin amount
  assert.equal(assertReportPayload({ appId: 'stockflow', licenseExternalId: 'x', amount: 0 }).ok, false) // amount debe ser > 0
  assert.equal(assertReportPayload({ appId: 'stockflow', licenseExternalId: 'x', amount: -5 }).ok, false)
})

test('assertReportPayload: acepta con amount positivo, reference/note opcionales', () => {
  const r = assertReportPayload({ appId: 'stockflow', licenseExternalId: 'x', amount: 590 })
  assert.equal(r.ok, true)
})
