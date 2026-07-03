import { test } from 'node:test'
import assert from 'node:assert/strict'
import { messagingFor, renderMessage } from './messaging.js'

const app = messagingFor('flowfin')

test('payment_confirmed: subject agradece y html trae fecha y período', () => {
  const out = renderMessage('payment_confirmed', {
    app, tenantName: 'Panadería Sol', date: '2026-08-01T00:00:00Z', periodMonths: 12, reference: 'MP-999',
  })
  assert.match(out.subject, /Panader[ií]a Sol/)
  assert.match(out.subject, /activa/i)
  assert.match(out.html, /un a[ñn]o/)               // 12 meses → "un año"
  assert.match(out.html, /1 de agosto de 2026/)     // fecha formateada es-MX
  assert.match(out.html, /MP-999/)                  // referencia incluida
})

test('payment_confirmed: 1 mes se describe como "un mes" y sin referencia opcional', () => {
  const out = renderMessage('payment_confirmed', { app, tenantName: 'Tienda X', date: '2026-08-01T00:00:00Z', periodMonths: 1 })
  assert.match(out.html, /un mes/)
  assert.doesNotMatch(out.html, /Referencia de pago/)
})

test('renderMessage sigue soportando renewal y renewal_fyi (correos del día 1)', () => {
  const manual = renderMessage('renewal', { app, tenantName: 'T', date: '2026-07-20T00:00:00Z', days: 5 })
  assert.match(manual.subject, /renueva/i)
  const auto = renderMessage('renewal_fyi', { app, tenantName: 'T', date: '2026-08-01T00:00:00Z' })
  assert.match(auto.subject, /renueva solo/i)
})
