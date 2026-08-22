import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLicenseChange, computeRenewalExpiry, billingFor, licenseControlFor, deriveMirror, plansFor } from './licenseControl.js'

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
    fields: { plan: 'parish_plan', license_status: 'parish_license_status', support_priority_addon: 'parish_support_priority_addon' },
  })
})

test('cateqhub set_addon: implementation solo acepta none/completed y estampa implementation_completed_at', () => {
  const { patch, error } = buildLicenseChange('cateqhub', 'set_addon', { addonKey: 'implementation', addonValue: 'completed', now: '2026-07-28T12:00:00Z' })
  assert.equal(error, undefined)
  assert.equal(patch.implementation_status, 'completed')
  assert.equal(patch.implementation_completed_at, '2026-07-28T12:00:00.000Z')

  const invalid = buildLicenseChange('cateqhub', 'set_addon', { addonKey: 'implementation', addonValue: 'requested' })
  assert.ok(invalid.error)
})

test('cateqhub set_addon: support_priority es un booleano puro, sin stamp', () => {
  const on = buildLicenseChange('cateqhub', 'set_addon', { addonKey: 'support_priority', addonValue: true })
  assert.equal(on.patch.support_priority_addon, true)
  assert.equal(Object.keys(on.patch).length, 1)

  const off = buildLicenseChange('cateqhub', 'set_addon', { addonKey: 'support_priority', addonValue: false })
  assert.equal(off.patch.support_priority_addon, false)
})

test('deriveMirror: solo incluye campos presentes en el patch, con su valor nuevo', () => {
  const cfg = licenseControlFor('cateqhub')
  assert.deepEqual(deriveMirror(cfg, { support_priority_addon: true }), [
    { entity: 'User', matchField: 'parish_id', fields: { parish_support_priority_addon: true } },
  ])
  assert.deepEqual(deriveMirror(cfg, { name: 'Parroquia X' }), undefined)
  assert.deepEqual(deriveMirror({ mirror: undefined }, { plan: 'premium' }), undefined)
})

// ── lifecycle unificado (portafolio) + plan oculto 'founder' ─────────────────

test('lifecycle unificado: los 6 apps de licencia de asiento tienen read-only y bloqueo', () => {
  // Rumbo y Radar se sumaron el 2026-08-03 (PRs #88/#12): view_only agregado
  // a su schema y desplegado al backend de Base44 (npx base44 entities push,
  // confirmado por el owner) — antes de esto readOnlyStatus era null para
  // ambos y el cron solo podía mandar el correo del día 8, no aplicar el
  // estado (ver enforcementGap en license-lifecycle.js).
  for (const id of ['flowfin', 'stockflow', 'liuma', 'puntos', 'rumbo', 'radar']) {
    const cfg = licenseControlFor(id)
    assert.equal(cfg.lifecycle.graceDaysToReadOnly, 8)
    assert.equal(cfg.lifecycle.graceDaysToBlocked, 15)
    assert.equal(cfg.lifecycle.graceDaysToInactive, 30)
    assert.equal(cfg.lifecycle.graceDaysToDeletionEligible, 45)
    assert.equal(cfg.lifecycle.readOnlyStatus, cfg.statuses.view_only)
    assert.equal(cfg.lifecycle.blockedStatus, cfg.statuses.suspended)
  }
})

test('cateqhub se sumó al ciclo unificado 8/15/30/45 el 2026-08-03 (directiva "no exceptions" del owner)', () => {
  const cfg = licenseControlFor('cateqhub')
  assert.equal(cfg.lifecycle.graceDaysToReadOnly, 8)
  assert.equal(cfg.lifecycle.graceDaysToBlocked, 15)
  assert.equal(cfg.lifecycle.graceDaysToInactive, 30)
  assert.equal(cfg.lifecycle.graceDaysToDeletionEligible, 45)
  assert.equal(cfg.lifecycle.readOnlyStatus, cfg.statuses.view_only)
  assert.equal(cfg.lifecycle.blockedStatus, cfg.statuses.suspended)
  assert.equal(cfg.lifecycle.sinceFields, undefined) // ya no existe el modelo por-etapa
  // Lo que sí sigue siendo propio de cateqhub: el freno de exportConfirmed y
  // su copy de correo (ver portfolioLifecycle.test.js para la lógica).
  assert.equal(cfg.lifecycle.exportConfirmedField, 'export_confirmed_at')
  assert.deepEqual(cfg.lifecycle.emailKinds, { read_only: 'premium_read_only_reminder', blocked: 'premium_access_denied_reminder' })
  assert.equal(cfg.lifecycle.periodEndField, 'premium_period_end_at') // sigue siendo el único app con activación manual de plan
})

test("plan oculto 'founder' disponible en los 6 apps de licencia de asiento", () => {
  for (const id of ['flowfin', 'stockflow', 'liuma', 'puntos', 'rumbo', 'radar']) {
    assert.ok(plansFor(id).includes('founder'), `${id} debería listar founder`)
  }
  assert.ok(!plansFor('cateqhub').includes('founder')) // CateqHub no tiene licencia de asiento
})

test('lifecycle unificado: paidPlanValues excluye founder (y trial, donde el app lo tiene) de plans', () => {
  for (const id of ['flowfin', 'stockflow', 'liuma', 'puntos', 'rumbo', 'radar']) {
    const cfg = licenseControlFor(id)
    assert.ok(Array.isArray(cfg.lifecycle.paidPlanValues) && cfg.lifecycle.paidPlanValues.length > 0, `${id} debería tener paidPlanValues`)
    assert.ok(!cfg.lifecycle.paidPlanValues.includes('founder'), `${id}: paidPlanValues no debería incluir founder`)
    // Todo valor en paidPlanValues debe ser un plan real del app.
    for (const p of cfg.lifecycle.paidPlanValues) assert.ok(cfg.plans.includes(p), `${id}: '${p}' no está en plans`)
  }
})

test("lifecycle unificado: rumbo excluye 'trial' de paidPlanValues (confirmado en producción: tenant trial 6 días vencido no debe entrar al ciclo)", () => {
  const cfg = licenseControlFor('rumbo')
  assert.deepEqual(cfg.lifecycle.paidPlanValues, ['starter', 'pro', 'enterprise'])
  assert.ok(cfg.plans.includes('trial')) // rumbo sí tiene 'trial' como plan real...
  assert.ok(!cfg.lifecycle.paidPlanValues.includes('trial')) // ...pero no es un plan pago vencible
})

// ── regresión: set_plan NO debe estampar una llave "undefined" en los 6 apps ──
// que ganaron paidPlanValues (commit 9d8995c) pero no tienen periodEndField.
// Solo cateqhub tiene periodEndField — el gate de arriba en buildLicenseChange
// debe requerir AMBOS (periodEndField Y paidPlanValues.includes(plan)), no solo
// el segundo, o patch[undefined] = ... se cuela como llave "undefined" literal.

test('set_plan en los 6 apps sin periodEndField: patch tiene EXACTAMENTE una llave (planField), nunca "undefined"', () => {
  const cases = [
    ['flowfin', 'home'],
    ['stockflow', 'start'],
    ['liuma', 'start'],
    ['puntos', 'starter'],
    ['rumbo', 'starter'],
    ['radar', 'starter'],
  ]
  for (const [id, plan] of cases) {
    const cfg = licenseControlFor(id)
    assert.equal(cfg.lifecycle.periodEndField, undefined, `${id} no debería tener periodEndField`)
    assert.ok(cfg.lifecycle.paidPlanValues.includes(plan), `${id}: '${plan}' debería ser un paidPlanValue de prueba`)

    const { patch, error } = buildLicenseChange(id, 'set_plan', { plan, now: NOW })
    assert.equal(error, undefined, `${id} set_plan no debería fallar`)
    assert.deepEqual(Object.keys(patch), [cfg.planField], `${id}: patch debería tener solo [${cfg.planField}]`)
    assert.equal(patch.undefined, undefined, `${id}: patch NO debería tener una llave "undefined"`)
    assert.equal('undefined' in patch, false, `${id}: patch NO debería tener la llave literal "undefined"`)
  }
})

// ── set_dates: el operador escribe la fecha, tal cual ────────────────────────

test('set_dates escribe el vencimiento como fin del día (campo datetime)', () => {
  const { patch, newExpiry, error } = buildLicenseChange('stockflow', 'set_dates', { expiryDate: '2026-09-30', now: NOW })
  assert.equal(error, undefined)
  // Fin del día, no 00:00: una licencia "hasta el 30" sigue válida durante el 30.
  assert.equal(patch.license_expires_at, '2026-09-30T23:59:59.000Z')
  assert.equal(newExpiry, '2026-09-30T23:59:59.000Z')
  assert.equal('billing_status' in patch, false, 'no debe tocar el estado sin alsoActivate')
})

test('set_dates respeta el formato date y espeja renews_at en rumbo', () => {
  const { patch } = buildLicenseChange('rumbo', 'set_dates', { expiryDate: '2026-09-30', now: NOW })
  assert.equal(patch.current_period_end, '2026-09-30')
  assert.equal(patch.renews_at, '2026-09-30', 'rumbo espeja el vencimiento en renews_at')
})

test('set_dates NO aplica el dayConvention del app (a diferencia de confirm_payment)', () => {
  // flowfin normalmente cae al 1° del mes; una fecha escrita a mano se respeta.
  const { patch } = buildLicenseChange('flowfin', 'set_dates', { expiryDate: '2026-09-17', now: NOW })
  assert.equal(patch.license_expires_at, '2026-09-17T23:59:59.000Z')
})

test('set_dates edita el vencimiento de cateqhub aunque no tenga billing', () => {
  // Su fecha vive en lifecycle.periodEndField, no en un bloque billing.
  const { patch, error } = buildLicenseChange('cateqhub', 'set_dates', { expiryDate: '2026-12-01', now: NOW })
  assert.equal(error, undefined)
  assert.equal(patch.premium_period_end_at, '2026-12-01T23:59:59.000Z')
})

test('set_dates rechaza una fecha mal escrita y una app sin fecha de prueba', () => {
  assert.match(buildLicenseChange('stockflow', 'set_dates', { expiryDate: '30/09/2026' }).error, /inválida/)
  assert.match(buildLicenseChange('radar', 'set_dates', { trialEndsAt: '2026-09-30' }).error, /prueba/)
  assert.match(buildLicenseChange('stockflow', 'set_dates', {}).error, /ninguna fecha/)
})

test('set_dates con alsoActivate reactiva además de mover la fecha', () => {
  const { patch } = buildLicenseChange('puntos', 'set_dates', { expiryDate: '2026-09-30', alsoActivate: true, now: NOW })
  assert.equal(patch.billing_status, 'active')
  assert.equal(patch.status, 'active', 'puntos también abre su gate operativo')
})

// ── cancel: baja de la licencia ──────────────────────────────────────────────

test('cancel usa el estado terminal del app y vence la licencia hoy', () => {
  const rumbo = buildLicenseChange('rumbo', 'cancel', { now: NOW })
  assert.equal(rumbo.patch.status, 'cancelled', 'rumbo sí tiene "cancelled" en su enum')
  assert.equal(rumbo.patch.current_period_end, '2026-06-15')

  const sf = buildLicenseChange('stockflow', 'cancel', { now: NOW })
  assert.equal(sf.patch.billing_status, 'suspended', 'sin enum de cancelación, cae a suspendida')
  assert.equal(sf.patch.license_expires_at, '2026-06-15T12:00:00.000Z')

  const cq = buildLicenseChange('cateqhub', 'cancel', { now: NOW })
  assert.equal(cq.patch.license_status, 'access_denied')
})

test('cancel se registra como "archived" en la bitácora de puntos', () => {
  const { log } = buildLicenseChange('puntos', 'cancel', { now: NOW })
  assert.equal(log.row.event_type, 'archived', 'debe ser un valor del enum de LicenseEvent')
})

test('set_dates hacia atrás se registra como vencimiento, no como renovación', () => {
  const back = buildLicenseChange('puntos', 'set_dates', { expiryDate: '2026-01-01', now: NOW })
  assert.equal(back.log.row.event_type, 'license_expired')
  const fwd = buildLicenseChange('puntos', 'set_dates', { expiryDate: '2026-12-01', now: NOW })
  assert.equal(fwd.log.row.event_type, 'license_renewed')
})
