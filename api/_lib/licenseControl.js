// Per-app license-control model. Every Base44 app changes its license by writing
// its license entity as service-role (acaciaControl `license.set`); only the
// field names + enum values differ. Mission Control owns this mapping and builds
// the patch, so the bridge stays generic. Operations are intentionally minimal
// and additive (status / plan), never destructive (no delete/archive here).

// `billing` describes how a renewal/payment-confirmation is written to each app's
// license entity (all fields live on that same entity, written via `license.set`):
//   expiryField  — the license-expiry date that "Confirmar pago" advances.
//   trialField   — the trial-end date (used by MC to flag "prueba vencida").
//   dateFormat   — 'date' (YYYY-MM-DD) or 'datetime' (full ISO) per the schema.
//   payment      — extra fields to stamp when a payment is confirmed:
//                  'ref'  → set `payment_reference`;
//                  'full' → also stamp last_payment_confirmed_at/by/period/reference
//                           (FlowFin & LIUMA model this explicitly);
//                  'rumbo'→ stamp last_payment_at + mirror expiry into renews_at.
//   dayConvention— how the new expiry day is chosen, to MATCH each app's own
//                  renewal logic (verified against the app source):
//                  'first_of_month' → land on the 1st of (base month + N). FlowFin
//                     `confirmLicensePayment.calculateExpiry` + LIUMA
//                     `licenseModel.calculateExpiry` both do this (Mercado Pago
//                     bills on the 1st), so MC must too or licenses expire a few
//                     days before the next auto-charge.
//                  'preserve_day'   → keep the day-of-month, add N months. Matches
//                     StockFlow `processMonthlyRenewal` and Rumbo `licensesAdmin`.
//   activeExtra  — extra fields to also flip to 'active' on reactivate/confirm
//                  (puntos has a separate operativo `status` its renew also sets).
const APPS = {
  flowfin: {
    entity: 'Family', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['home', 'family_plus', 'circle'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_at', dateFormat: 'datetime', payment: 'full', dayConvention: 'first_of_month' },
  },
  stockflow: {
    entity: 'Business', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['start', 'growth', 'pro'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_at', dateFormat: 'datetime', payment: 'ref', dayConvention: 'preserve_day' },
  },
  // Radar (HR/attendance): license lives on the Company entity. No trial or
  // payment-reference fields modeled yet; expiry is a plain date (license_expiry).
  radar: {
    entity: 'Company', statusField: 'status', planField: 'tier',
    statuses: { active: 'active', suspended: 'suspended' },
    plans: ['starter', 'pro', 'enterprise'],
    billing: { expiryField: 'license_expiry', trialField: null, dateFormat: 'date', payment: null, dayConvention: 'preserve_day' },
  },
  rumbo: {
    entity: 'TenantLicense', statusField: 'status', planField: 'plan',
    statuses: { active: 'active', suspended: 'suspended' }, // suspend auto-blocks write_access
    plans: ['trial', 'starter', 'pro', 'enterprise'],
    billing: { expiryField: 'current_period_end', trialField: 'trial_ends_at', dateFormat: 'date', payment: 'rumbo', dayConvention: 'preserve_day' },
  },
  liuma: {
    entity: 'SchoolSubscription', statusField: 'subscription_status', planField: 'license_tier',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['start', 'growth', 'plus'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_date', dateFormat: 'datetime', payment: 'full', dayConvention: 'first_of_month' },
  },
  puntos: {
    entity: 'Business', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['starter', 'growth', 'pro', 'enterprise'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_at', dateFormat: 'datetime', payment: 'ref', dayConvention: 'preserve_day', activeExtra: { status: 'active' } },
    // puntos keeps an append-only LicenseEvent audit; mirror MC actions into it.
    audit: { entity: 'LicenseEvent', idField: 'business_id', eventType: {
      reactivate: 'reactivated', suspend: 'suspended', view_only: 'view_only', set_plan: 'plan_changed',
      confirm_payment: 'license_renewed',
    } },
  },
}

export function licenseControlFor(appId) {
  return APPS[appId] ?? null
}

// Human label for each op (for confirmation + audit notes).
export const OP_LABEL = {
  reactivate: 'Reactivar (activar)',
  suspend: 'Suspender (pausar)',
  view_only: 'Solo lectura',
  set_plan: 'Cambiar plan',
  confirm_payment: 'Confirmar pago (renovar)',
}

// Billing config for the renewal/payment flow (null when the app has none).
export function billingFor(appId) {
  return APPS[appId]?.billing ?? null
}

// Add whole months to a date, clamping day-of-month overflow (e.g. Jan 31 + 1mo
// lands on the last day of February, not March 3). Returns a new Date.
function addMonths(base, months) {
  const d = new Date(base.getTime())
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return d
}

// Compute the new expiry for a +N-month renewal. A renewal stacks: if the current
// expiry is still in the future, extend from it; otherwise start from today (no
// retroactive credit). `dayConvention` matches the target app's own renewal math
// (see APPS.billing). Pass `now` explicitly so callers/tests are deterministic.
export function computeRenewalExpiry({ currentExpiry, periodMonths = 1, dateFormat = 'datetime', dayConvention = 'preserve_day', now = new Date() } = {}) {
  const cur = currentExpiry ? new Date(currentExpiry) : null
  const base = cur && !Number.isNaN(cur.getTime()) && cur.getTime() > now.getTime() ? cur : now
  let next = addMonths(base, periodMonths)
  if (dayConvention === 'first_of_month') {
    // Land on the 1st of the resulting month at 00:00 UTC — mirrors FlowFin/LIUMA
    // calculateExpiry (Mercado Pago bills on the 1st).
    next = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 1, 0, 0, 0, 0))
  }
  return dateFormat === 'date' ? next.toISOString().slice(0, 10) : next.toISOString()
}

// Build the { patch, log } the bridge `license.set` expects for one operation.
// Returns { error } when the op/plan is invalid for the app.
// ctx (confirm_payment only): { currentExpiry, periodMonths, paymentReference, now }.
export function buildLicenseChange(appId, op, { plan, actorEmail, currentExpiry, periodMonths, paymentReference, now } = {}) {
  const cfg = APPS[appId]
  if (!cfg) return { error: `app ${appId} no soporta control de licencia` }

  const patch = {}
  let toStatus = null
  let newExpiry = null
  if (op === 'reactivate' || op === 'suspend' || op === 'view_only') {
    const val = cfg.statuses[op === 'reactivate' ? 'active' : op]
    if (!val) return { error: `'${op}' no aplica a ${appId}` }
    patch[cfg.statusField] = val
    toStatus = val
    // Reactivation should also clear a second operativo gate (puntos `status`).
    if (op === 'reactivate' && cfg.billing?.activeExtra) Object.assign(patch, cfg.billing.activeExtra)
  } else if (op === 'set_plan') {
    if (!plan || !cfg.plans.includes(plan)) return { error: `plan inválido para ${appId}: ${plan}` }
    patch[cfg.planField] = plan
  } else if (op === 'confirm_payment') {
    const b = cfg.billing
    if (!b) return { error: `${appId} no soporta confirmación de pago` }
    const months = Number(periodMonths) || 1
    const when = now ? new Date(now) : new Date()
    newExpiry = computeRenewalExpiry({ currentExpiry, periodMonths: months, dateFormat: b.dateFormat, dayConvention: b.dayConvention, now: when })
    // A confirmed payment always lands the tenant on 'active' with a fresh expiry.
    patch[cfg.statusField] = cfg.statuses.active
    patch[b.expiryField] = newExpiry
    toStatus = cfg.statuses.active
    // Some apps gate on a second field too (puntos operativo `status`); mirror it.
    if (b.activeExtra) Object.assign(patch, b.activeExtra)
    const ref = paymentReference ? String(paymentReference) : undefined
    const period = when.toISOString().slice(0, 7) // YYYY-MM
    if (b.payment === 'ref') {
      if (ref) patch.payment_reference = ref
    } else if (b.payment === 'full') {
      patch.last_payment_confirmed_at = when.toISOString()
      patch.last_payment_confirmed_by = actorEmail || 'mission-control'
      patch.last_payment_period = period
      if (ref) { patch.last_payment_reference = ref; patch.payment_reference = ref }
    } else if (b.payment === 'rumbo') {
      patch.last_payment_at = when.toISOString().slice(0, 10)
      patch.renews_at = newExpiry
    }
  } else {
    return { error: `op desconocida: ${op}` }
  }

  const out = { patch }
  if (newExpiry) out.newExpiry = newExpiry
  if (cfg.audit) {
    out.log = {
      entity: cfg.audit.entity,
      row: {
        [cfg.audit.idField]: undefined, // filled with the record id by the caller
        event_type: cfg.audit.eventType[op] ?? op,
        to_status: toStatus ?? undefined,
        to_plan: op === 'set_plan' ? plan : undefined,
        payment_reference: op === 'confirm_payment' && paymentReference ? String(paymentReference) : undefined,
        actor_email: actorEmail || 'mission-control',
        notes: `Mission Control: ${OP_LABEL[op] ?? op}`,
        effective_at: new Date().toISOString(),
      },
    }
  }
  return out
}

// List the valid plans for an app (for the UI plan picker).
export function plansFor(appId) {
  return APPS[appId]?.plans ?? []
}
