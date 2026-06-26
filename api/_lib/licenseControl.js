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
const APPS = {
  flowfin: {
    entity: 'Family', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['home', 'family_plus', 'circle'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_at', dateFormat: 'datetime', payment: 'full' },
  },
  stockflow: {
    entity: 'Business', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['start', 'growth', 'pro'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_at', dateFormat: 'datetime', payment: 'ref' },
  },
  rumbo: {
    entity: 'TenantLicense', statusField: 'status', planField: 'plan',
    statuses: { active: 'active', suspended: 'suspended' }, // suspend auto-blocks write_access
    plans: ['trial', 'starter', 'pro', 'enterprise'],
    billing: { expiryField: 'current_period_end', trialField: 'trial_ends_at', dateFormat: 'date', payment: 'rumbo' },
  },
  liuma: {
    entity: 'SchoolSubscription', statusField: 'subscription_status', planField: 'license_tier',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['start', 'growth', 'plus'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_date', dateFormat: 'datetime', payment: 'full' },
  },
  puntos: {
    entity: 'Business', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['starter', 'growth', 'pro', 'enterprise'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_at', dateFormat: 'datetime', payment: 'ref' },
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
// retroactive credit). Pass `now` explicitly so callers/tests are deterministic.
export function computeRenewalExpiry({ currentExpiry, periodMonths = 1, dateFormat = 'datetime', now = new Date() } = {}) {
  const cur = currentExpiry ? new Date(currentExpiry) : null
  const base = cur && !Number.isNaN(cur.getTime()) && cur.getTime() > now.getTime() ? cur : now
  const next = addMonths(base, periodMonths)
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
  } else if (op === 'set_plan') {
    if (!plan || !cfg.plans.includes(plan)) return { error: `plan inválido para ${appId}: ${plan}` }
    patch[cfg.planField] = plan
  } else if (op === 'confirm_payment') {
    const b = cfg.billing
    if (!b) return { error: `${appId} no soporta confirmación de pago` }
    const months = Number(periodMonths) || 1
    const when = now ? new Date(now) : new Date()
    newExpiry = computeRenewalExpiry({ currentExpiry, periodMonths: months, dateFormat: b.dateFormat, now: when })
    // A confirmed payment always lands the tenant on 'active' with a fresh expiry.
    patch[cfg.statusField] = cfg.statuses.active
    patch[b.expiryField] = newExpiry
    toStatus = cfg.statuses.active
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
