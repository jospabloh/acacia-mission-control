import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLicenseChange, computeRenewalExpiry, billingFor, licenseControlFor } from './licenseControl.js'

// Fixed clock so every assertion is deterministic.
const NOW = new Date('2026-06-15T12:00:00Z')

// ── computeRenewalExpiry: stacking + per-app day convention ──────────────────

test('renewal stacks on a still-valid expiry (preserve_day)', () => {
  const out = computeRenewalExpiry({ currentExpiry: '2026-07-10T00:00:00Z', periodMonths: 1, dayConvention: 'preserve_day', now: NOW })
  assert.equal(out, '2026-08-10T00:00:00.000Z')
})

test('renewal starts from today when expired (no retroactive credit)', () => {
  const out = computeRenewalExpiry({ currentExpiry: '2026-01-01T00:00:00Z', periodMonths: 1, dayConvention: 'preserve_day', now: NOW })
  assert.equal(out, '2026-07-15T12:00:00.000Z')
})

test('first_of_month lands on the 1st (FlowFin/LIUMA, Mercado Pago bills then)', () => {
  // Expired → base today (Jun 15) +1mo → Jul 15 → floored to Jul 1.
  assert.equal(computeRenewalExpiry({ currentExpiry: null, periodMonths: 1, dayConvention: 'first_of_month', now: NOW }), '2026-07-01T00:00:00.000Z')
  // Future expiry already on the 1st → stacks cleanly.
  assert.equal(computeRenewalExpiry({ currentExpiry: '2026-08-01T00:00:00Z', periodMonths: 1, dayConvention: 'first_of_month', now: NOW }), '2026-09-01T00:00:00.000Z')
})

test('month overflow clamps to the last valid day (preserve_day)', () => {
  // Jan 31 + 1mo must not roll into March.
  const out = computeRenewalExpiry({ currentExpiry: '2026-01-31T00:00:00Z', periodMonths: 1, dayConvention: 'preserve_day', now: new Date('2026-01-15T00:00:00Z') })
  assert.equal(out.slice(0, 10), '2026-02-28')
})

test('date-format apps return YYYY-MM-DD, not full ISO (rumbo)', () => {
  const out = computeRenewalExpiry({ currentExpiry: '2026-07-10', periodMonths: 1, dateFormat: 'date', dayConvention: 'preserve_day', now: NOW })
  assert.equal(out, '2026-08-10')
})

// ── buildLicenseChange: confirm_payment patches the field each app enforces ──

test('dayConventionOverride forces first_of_month on a preserve_day app (auto-renovación)', () => {
  // stockflow es preserve_day normalmente; la renovación automática fuerza el 1°.
  const { patch, newExpiry } = buildLicenseChange('stockflow', 'confirm_payment', {
    currentExpiry: '2026-07-10T00:00:00Z', periodMonths: 1, now: NOW, dayConventionOverride: 'first_of_month',
  })
  assert.equal(patch.license_expires_at, '2026-08-01T00:00:00.000Z')
  assert.equal(newExpiry, '2026-08-01T00:00:00.000Z')
  // Sin override respetaría el día (preserve_day → 2026-08-10).
  const { patch: base } = buildLicenseChange('stockflow', 'confirm_payment', { currentExpiry: '2026-07-10T00:00:00Z', periodMonths: 1, now: NOW })
  assert.equal(base.license_expires_at, '2026-08-10T00:00:00.000Z')
})

test('flowfin confirm_payment: license_expires_at on the 1st + full payment fields', () => {
  const { patch } = buildLicenseChange('flowfin', 'confirm_payment', { currentExpiry: '2026-01-01T00:00:00Z', periodMonths: 1, paymentReference: 'MP-1', actorEmail: 'op@acacia.mx', now: NOW })
  assert.equal(patch.billing_status, 'active')
  assert.equal(patch.license_expires_at, '2026-07-01T00:00:00.000Z')
  assert.equal(patch.last_payment_reference, 'MP-1')
  assert.equal(patch.payment_reference, 'MP-1')
  assert.equal(patch.last_payment_period, '2026-06')
  assert.equal(patch.last_payment_confirmed_by, 'op@acacia.mx')
})

test('stockflow confirm_payment: license_expires_at preserve_day + payment_reference only', () => {
  const { patch } = buildLicenseChange('stockflow', 'confirm_payment', { currentExpiry: '2026-07-10T00:00:00Z', periodMonths: 1, paymentReference: 'MP-2', now: NOW })
  assert.equal(patch.billing_status, 'active')
  assert.equal(patch.license_expires_at, '2026-08-10T00:00:00.000Z')
  assert.equal(patch.payment_reference, 'MP-2')
  assert.equal(patch.last_payment_confirmed_at, undefined) // stockflow has no last_payment_* fields
})

test('rumbo confirm_payment: current_period_end (date) + last_payment_at + renews_at, status active', () => {
  const { patch } = buildLicenseChange('rumbo', 'confirm_payment', { currentExpiry: '2026-07-10', periodMonths: 1, now: NOW })
  assert.equal(patch.status, 'active')
  assert.equal(patch.current_period_end, '2026-08-10')
  assert.equal(patch.renews_at, '2026-08-10')
  assert.equal(patch.last_payment_at, '2026-06-15')
})

test('liuma confirm_payment writes license_expires_at (not subscription_end_date), on the 1st', () => {
  const { patch } = buildLicenseChange('liuma', 'confirm_payment', { currentExpiry: null, periodMonths: 1, now: NOW })
  assert.equal(patch.subscription_status, 'active')
  assert.equal(patch.license_expires_at, '2026-07-01T00:00:00.000Z')
  assert.equal(patch.subscription_end_date, undefined)
})

test('puntos confirm_payment also flips operativo status + writes license_renewed audit', () => {
  const out = buildLicenseChange('puntos', 'confirm_payment', { currentExpiry: null, periodMonths: 1, paymentReference: 'F-7', actorEmail: 'op@acacia.mx', now: NOW })
  assert.equal(out.patch.billing_status, 'active')
  assert.equal(out.patch.status, 'active') // separate operativo gate the app's renew also sets
  assert.equal(out.patch.license_expires_at, '2026-07-15T12:00:00.000Z')
  assert.equal(out.patch.payment_reference, 'F-7')
  assert.equal(out.log.row.event_type, 'license_renewed')
  assert.equal(out.log.row.payment_reference, 'F-7')
})

test('puntos reactivate clears the operativo status gate too; flowfin does not have one', () => {
  assert.deepEqual(buildLicenseChange('puntos', 'reactivate', {}).patch, { billing_status: 'active', status: 'active' })
  assert.deepEqual(buildLicenseChange('flowfin', 'reactivate', {}).patch, { billing_status: 'active' })
})

test('every billing app exposes an expiry field + day convention', () => {
  for (const app of ['flowfin', 'stockflow', 'rumbo', 'liuma', 'puntos']) {
    const b = billingFor(app)
    assert.ok(b && b.expiryField, `${app} missing expiryField`)
    assert.ok(['first_of_month', 'preserve_day'].includes(b.dayConvention), `${app} bad dayConvention`)
  }
})

test('invalid op / unknown app are rejected, not silently applied', () => {
  assert.ok(buildLicenseChange('flowfin', 'frobnicate', {}).error)
  assert.ok(buildLicenseChange('nope', 'confirm_payment', {}).error)
})

// ── cateqhub: no billing, mirror config, set_plan stamps premium_period_end_at ──

test('cateqhub has no billing (Premium se activa manualmente, sin Mercado Pago hoy)', () => {
  assert.equal(billingFor('cateqhub'), null)
})

test('cateqhub set_plan a premium estampa premium_period_end_at a +30 días', () => {
  const NOW2 = new Date('2026-07-23T00:00:00Z')
  const change = buildLicenseChange('cateqhub', 'set_plan', { plan: 'premium', now: NOW2 })
  assert.equal(change.error, undefined)
  assert.equal(change.patch.plan, 'premium')
  assert.equal(change.patch.premium_period_end_at, '2026-08-22T00:00:00.000Z')
})

test('cateqhub set_plan a free NO estampa premium_period_end_at', () => {
  const change = buildLicenseChange('cateqhub', 'set_plan', { plan: 'free' })
  assert.equal(change.error, undefined)
  assert.equal(change.patch.plan, 'free')
  assert.equal(change.patch.premium_period_end_at, undefined)
})

test('cateqhub statuses mapean read_only/access_denied a las llaves genéricas view_only/suspended', () => {
  const cfg = licenseControlFor('cateqhub')
  assert.equal(cfg.statuses.view_only, 'read_only')
  assert.equal(cfg.statuses.suspended, 'access_denied')
  assert.equal(cfg.statuses.active, 'active')
})

test('cateqhub declara mirror hacia User (Base44 RLS no puede hacer lookup a Parish)', () => {
  const cfg = licenseControlFor('cateqhub')
  assert.deepEqual(cfg.mirror, {
    entity: 'User', matchField: 'parish_id',
    fields: { plan: 'parish_plan', license_status: 'parish_license_status' },
  })
})
