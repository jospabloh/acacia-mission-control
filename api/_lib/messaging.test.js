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

test('cateqhub: messagingFor resuelve destinatario vía User (parish_id/parish_role)', () => {
  const cfg = messagingFor('cateqhub')
  assert.ok(cfg)
  assert.equal(cfg.entity, 'Parish')
  assert.deepEqual(cfg.recipient.related.roles, ['admin'])
  assert.equal(cfg.recipient.related.roleField, 'parish_role')
})

test('premium_read_only: menciona toda la app pausada, nunca datos eliminados', () => {
  const app = messagingFor('cateqhub')
  const out = renderMessage('premium_read_only', { app, tenantName: 'Parroquia San Juan' })
  assert.match(out.subject, /San Juan/)
  assert.match(out.html, /toda la app/)
  assert.doesNotMatch(out.html, /niñas.*eliminad|asistencia.*eliminad|Tutores.*eliminad/i)
})

test('premium_access_denied: incluye instrucciones de exportar dentro de CateqHub', () => {
  const app = messagingFor('cateqhub')
  const out = renderMessage('premium_access_denied', { app, tenantName: 'Parroquia San Juan' })
  assert.match(out.html, /exportar/i)
})

test('premium_read_only_reminder y premium_access_denied_reminder son correos distintos', () => {
  const app = messagingFor('cateqhub')
  const a = renderMessage('premium_read_only_reminder', { app, tenantName: 'T' })
  const b = renderMessage('premium_access_denied_reminder', { app, tenantName: 'T' })
  assert.notEqual(a.subject, b.subject)
})

test('premium_data_deleted_confirmation confirma el borrado de Tutores, no de niños', () => {
  const app = messagingFor('cateqhub')
  const out = renderMessage('premium_data_deleted_confirmation', { app, tenantName: 'T' })
  assert.match(out.html, /Tutores/)
})
