import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newExternalIds, renderNewTenantAlert } from './newTenantAlert.js'

// The owner must hear about a customer exactly when one appears — and only then.
test('a tenant the bodega did not know is new', () => {
  assert.deepEqual(newExternalIds(['a', 'b'], ['a', 'b', 'c']), ['c'])
})

test('a known tenant is never announced again, and duplicates collapse', () => {
  assert.deepEqual(newExternalIds(['a', 'b'], ['b', 'a', 'a']), [])
  assert.deepEqual(newExternalIds([], ['x', 'x']), ['x'])
})

test('ids compare as strings, so a numeric id from the app still matches the bodega', () => {
  assert.deepEqual(newExternalIds(['123'], [123, 456]), ['456'])
})

test('the email names the app and the customer in the subject, and escapes what the customer typed', () => {
  const { subject, html } = renderNewTenantAlert({
    appName: 'StockFlow', tenantName: 'Baristop <Durango>', externalId: 'abc123',
    plan: 'start', status: 'trial', createdBy: 'karime@example.com', createdAt: '2026-09-24T16:33:34Z', via: 'ping',
  })
  assert.match(subject, /StockFlow/)
  assert.match(subject, /Baristop <Durango>/)
  assert.ok(html.includes('Baristop &lt;Durango&gt;'), 'business name must be HTML-escaped in the body')
  assert.ok(!html.includes('<Durango>'))
  assert.match(html, /karime@example\.com/)
})

test('a tenant with no name still produces a usable subject', () => {
  const { subject } = renderNewTenantAlert({ appName: 'Rumbo', externalId: 'xyz789', via: 'sync' })
  assert.match(subject, /xyz789/)
})
