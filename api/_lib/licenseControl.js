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
    plans: ['home', 'family_plus', 'circle', 'founder'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_at', dateFormat: 'datetime', payment: 'full', dayConvention: 'first_of_month' },
    // Ciclo de vida unificado (portafolio) — ver
    // docs/superpowers/specs/2026-08-03-portfolio-license-lifecycle-design.md.
    // Acumulado desde current_period_end, NO por-etapa (a diferencia de
    // cateqhub abajo) — computePortfolioLifecycleStage (portfolioLifecycle.js)
    // no necesita "since fields" porque cada umbral se mide desde una sola fecha.
    // paidPlanValues excluye 'founder' (plan oculto, vitalicio — ver
    // portfolioLifecycle.js) de los planes de pago reales de flowfin.
    lifecycle: { paidPlanValues: ['home', 'family_plus', 'circle'], graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45, readOnlyStatus: 'view_only', blockedStatus: 'suspended' },
  },
  stockflow: {
    entity: 'Business', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['start', 'growth', 'pro', 'founder'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_at', dateFormat: 'datetime', payment: 'ref', dayConvention: 'preserve_day' },
    // paidPlanValues excluye 'founder' (plan oculto, vitalicio) de los planes
    // de pago reales de stockflow.
    lifecycle: { paidPlanValues: ['start', 'growth', 'pro'], graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45, readOnlyStatus: 'view_only', blockedStatus: 'suspended' },
  },
  // Radar (HR/attendance): license lives on the Company entity. No trial or
  // payment-reference fields modeled yet; expiry is a plain date (license_expiry).
  radar: {
    entity: 'Company', statusField: 'status', planField: 'tier',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['starter', 'pro', 'enterprise', 'founder'],
    billing: { expiryField: 'license_expiry', trialField: null, dateFormat: 'date', payment: null, dayConvention: 'preserve_day' },
    // view_only agregado y desplegado al backend de Base44 el 2026-08-03
    // (Company.jsonc enum: ["active","suspended","view_only"], PR #12,
    // deploy confirmado por el owner vía npx base44 entities push). El cron
    // ya puede aplicar el estado de solo-lectura del día 8, no solo mandar
    // el correo (ver enforcementGap en license-lifecycle.js — deja de
    // incrementarse para radar a partir de este cambio).
    // paidPlanValues excluye 'founder' de los planes de pago reales de radar.
    lifecycle: { paidPlanValues: ['starter', 'pro', 'enterprise'], graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45, readOnlyStatus: 'view_only', blockedStatus: 'suspended' },
  },
  rumbo: {
    entity: 'TenantLicense', statusField: 'status', planField: 'plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' }, // suspend auto-blocks write_access
    plans: ['trial', 'starter', 'pro', 'enterprise', 'founder'],
    billing: { expiryField: 'current_period_end', trialField: 'trial_ends_at', dateFormat: 'date', payment: 'rumbo', dayConvention: 'preserve_day' },
    // view_only agregado y desplegado al backend de Base44 el 2026-08-03
    // (TenantLicense.jsonc enum: ["active","expired","suspended","cancelled",
    // "view_only"], PR #88, deploy confirmado por el owner vía
    // npx base44 entities push). Mismo PR también restauró la rama
    // data.members.email en rls.update que un commit de base44-builder[bot]
    // había borrado sin review — ver CLAUDE.md de rumbo si hace falta el
    // contexto de esa regresión.
    // paidPlanValues excluye 'trial' (no es un plan pago vencido, es prueba
    // activa) y 'founder' — confirmado contra producción: un tenant Rumbo en
    // plan 'trial' 6 días vencido se estaba colando al ciclo de enforcement.
    // TenantLicense.jsonc también tiene status 'cancelled' en su enum, pero
    // cfg.statuses (arriba) no lo trackea todavía — fuera de alcance de este
    // fix (ver CLAUDE.md / spec del ciclo de vida), se resuelve solo con el
    // filtro de paidPlanValues por ahora.
    lifecycle: { paidPlanValues: ['starter', 'pro', 'enterprise'], graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45, readOnlyStatus: 'view_only', blockedStatus: 'suspended' },
  },
  liuma: {
    entity: 'SchoolSubscription', statusField: 'subscription_status', planField: 'license_tier',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['start', 'growth', 'plus', 'founder'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_date', dateFormat: 'datetime', payment: 'full', dayConvention: 'first_of_month' },
    // paidPlanValues excluye 'founder' de los planes de pago reales de liuma.
    lifecycle: { paidPlanValues: ['start', 'growth', 'plus'], graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45, readOnlyStatus: 'view_only', blockedStatus: 'suspended' },
  },
  puntos: {
    entity: 'Business', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['starter', 'growth', 'pro', 'enterprise', 'founder'],
    billing: { expiryField: 'license_expires_at', trialField: 'trial_end_at', dateFormat: 'datetime', payment: 'ref', dayConvention: 'preserve_day', activeExtra: { status: 'active' } },
    // puntos keeps an append-only LicenseEvent audit; mirror MC actions into it.
    audit: { entity: 'LicenseEvent', idField: 'business_id', eventType: {
      reactivate: 'reactivated', suspend: 'suspended', view_only: 'view_only', set_plan: 'plan_changed',
      confirm_payment: 'license_renewed',
    } },
    // paidPlanValues excluye 'founder' de los planes de pago reales de puntos.
    lifecycle: { paidPlanValues: ['starter', 'growth', 'pro', 'enterprise'], graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45, readOnlyStatus: 'view_only', blockedStatus: 'suspended' },
  },
  cateqhub: {
    entity: 'Parish', statusField: 'license_status', planField: 'plan',
    statuses: { active: 'active', suspended: 'access_denied', view_only: 'read_only' },
    plans: ['free', 'premium'],
    // Premium se activa/factura manualmente hoy (ver Premium.jsx del app) — sin
    // Mercado Pago todavía, así que no hay confirm_payment para este app.
    // Precio de referencia (informativo, no aplicado por este archivo) — plan
    // de cobro en 3 partes (2026-07-28):
    //   1) Implementación asistida (opcional, cargo único): hasta 150 niños
    //      $1,490 MXN, 151-350 $2,490, 351+/diócesis $3,990. Autoservicio
    //      sigue siendo $0.
    //   2) Mensualidad Premium por tramo de niños activos: Gratis $0 hasta
    //      50 niños; Premium 30 días de prueba y luego 51-150 $500/mes,
    //      151-250 $650, 251-350 $800, 351-450 $950, 451-550 $1,100,
    //      551-650 $1,250 (estos dos últimos acotados el 2026-07-28 —
    //      antes "cotizar", primer cliente de ese tamaño pidió cotización;
    //      mismo incremento de $150/100 niños que los tramos previos),
    //      651+ o diócesis multi-parroquia sigue a cotizar. Pago anual con
    //      2 meses gratis. Cada tramo Premium incluye soporte con
    //      prioridad hasta "high" (ver addons abajo).
    //   3) Soporte adicional a la carta: $550 MXN/hora, $990 MXN/sesión de
    //      capacitación extra, +$250 MXN/mes por el add-on de soporte
    //      prioritario (sube el tope de prioridad de ticket a "urgent").
    // Mismos números que Premium.jsx (asistencia-catecismo) y
    // apps/cateqhub.html (acaciaco-site) — si cambian, cambia en los tres.
    billing: null,
    // Base44 RLS no puede hacer lookup de Guardian/ChildGuardian → Parish
    // directamente, así que el app espeja plan/license_status (y, desde el
    // plan de cobro de 2026-07-28, support_priority_addon) en cada User de
    // la parroquia. license.set (puente) aplica este mirror después del patch
    // principal — ver spec hermana en asistencia-catecismo. deriveMirror()
    // abajo construye el `mirror` real a partir de lo que cambió en `patch`.
    mirror: {
      entity: 'User', matchField: 'parish_id',
      fields: { plan: 'parish_plan', license_status: 'parish_license_status', support_priority_addon: 'parish_support_priority_addon' },
    },
    // Add-ons del plan de cobro (2026-07-28, ver Premium.jsx del app): una
    // parroquia solo puede "solicitarlos" (implementation_requested_at /
    // support_priority_addon_requested_at, autoservicio dentro del app);
    // activarlos de verdad pasa solo por acá (rol de servicio), vía el op
    // 'set_addon' — ver buildLicenseChange.
    addons: {
      implementation: {
        // 'requested' NO se escribe desde aquí (lo hace la parroquia misma,
        // vía implementation_requested_at) — este add-on solo sirve para
        // confirmarla ('completed') o revertir un error de captura ('none').
        field: 'implementation_status', values: ['none', 'completed'],
        stampField: { completed: 'implementation_completed_at' },
      },
      support_priority: {
        field: 'support_priority_addon', values: [true, false],
      },
    },
    // plan="free" es un plan permanente y normal en CateqHub (núcleo completo
    // hasta freeDowngrade.childCap niños activos, sin Tutores/mensajería/
    // tareas/pulseras) — no una penalización. Toda parroquia nueva arranca en
    // plan=premium con 30 días de prueba (premium_period_end_at). Si ese
    // período vence sin renovarse:
    //   - freeDowngrade.childCap niños activos o menos → api/cron/
    //     license-lifecycle.js baja la parroquia directo a plan="free" antes
    //     de aplicar la transición a read_only (hook genérico, gateado en
    //     cfg.freeDowngrade — no hardcodeado a cateqhub).
    //   - más de freeDowngrade.childCap → sigue el ciclo de abajo
    //     (lifecycle), que restringe TODA la app (no solo Tutores) hasta
    //     pagar el nivel Premium que corresponda.
    // El borrado automático (ver license-delete-premium-data) sigue limitado
    // a Guardian/ChildGuardian (Tutores) — nunca a niños/grupos/asistencia —
    // y resetea la parroquia a plan="free" (el mismo plan permanente de
    // arriba, no un estado especial).
    freeDowngrade: {
      childCap: 50,
      freePlanValue: 'free',
      usage: { entity: 'Child', tenantField: 'parish_id', filterField: 'active', filterValue: true },
    },
    // Ciclo unificado (portafolio) — ver docs/superpowers/specs/2026-08-03-
    // portfolio-license-lifecycle-design.md. Hasta 2026-08-03, CateqHub tenía
    // su PROPIO ciclo por-etapa (15 días activo→read_only, 15 más
    // read_only→access_denied, 30 más access_denied→deletion_eligible, con
    // since-fields independientes por etapa) — el owner de la plataforma
    // pidió explícitamente "no exceptions": mismo umbral acumulado 8/15/30/45
    // desde periodEndField que los otros 6 apps, sin sinceFields. Su
    // diferencia real de negocio (freeDowngrade arriba, mirror arriba,
    // exportConfirmedField abajo, y el copy de correo propio en emailKinds)
    // se preserva vía hooks genéricos del cron — ver
    // api/cron/license-lifecycle.js.
    //
    // Cambio de comportamiento en vivo: el período de gracia antes de
    // read_only se ACORTA de 15 días a 8 el día que este cambio se
    // deploya (el cron de Mission Control no requiere un deploy aparte de
    // Base44, a diferencia de los cambios de schema) — una parroquia que
    // hoy está, por ejemplo, 10 días vencida y todavía "active" bajo el
    // modelo viejo, pasará a read_only en la primera corrida tras el merge.
    lifecycle: {
      paidPlanValues: ['premium'],
      graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45,
      readOnlyStatus: 'read_only', blockedStatus: 'access_denied',
      periodEndField: 'premium_period_end_at',
      // exportConfirmedField: si la parroquia ya confirmó su exportación de
      // Tutores, el ciclo nunca avanza más allá de `blocked` (ver
      // computePortfolioLifecycleStage) — mismo freno que el modelo por-etapa
      // tenía en el paso access_denied → deletion_eligible.
      exportConfirmedField: 'export_confirmed_at',
      // emailKinds: CateqHub conserva su copy propio (menciona la
      // exportación de Tutores explícitamente) en vez del genérico
      // license_read_only/license_blocked — ver messaging.js. inactive y
      // deletion_eligible no tienen override propio (inactive es una etapa
      // nueva que el modelo por-etapa no tenía; cae al genérico
      // license_inactive_warning, y deletion_eligible nunca manda correo en
      // ningún modelo).
      emailKinds: { read_only: 'premium_read_only_reminder', blocked: 'premium_access_denied_reminder' },
    },
  },
}

export function licenseControlFor(appId) {
  return APPS[appId] ?? null
}

// Build the `mirror` array license.set expects (see acaciaControl entry.ts)
// from cfg.mirror + a resolved patch: only source fields actually present in
// `patch` that have a mirror mapping are included, with their NEW value.
// Returns undefined when the app has no mirror config or nothing in `patch`
// needs mirroring (harmless to omit — license.set treats a missing `mirror`
// as a no-op). license-lifecycle.js (the cron) derives this inline instead of
// calling this helper, to avoid touching working cron logic; keep both in
// sync if the derivation ever changes.
export function deriveMirror(cfg, patch) {
  if (!cfg?.mirror) return undefined
  const fields = Object.fromEntries(
    Object.entries(cfg.mirror.fields)
      .filter(([sourceField]) => sourceField in patch)
      .map(([sourceField, mirrorField]) => [mirrorField, patch[sourceField]]),
  )
  if (Object.keys(fields).length === 0) return undefined
  return [{ entity: cfg.mirror.entity, matchField: cfg.mirror.matchField, fields }]
}

// Human label for each op (for confirmation + audit notes).
export const OP_LABEL = {
  reactivate: 'Reactivar (activar)',
  suspend: 'Suspender (pausar)',
  view_only: 'Solo lectura',
  set_plan: 'Cambiar plan',
  confirm_payment: 'Confirmar pago (renovar)',
  set_addon: 'Cambiar add-on',
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
export function buildLicenseChange(appId, op, { plan, actorEmail, currentExpiry, periodMonths, paymentReference, now, dayConventionOverride, addonKey, addonValue } = {}) {
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
    // Activar un plan de pago sin billing automatizado (hoy solo cateqhub) arranca
    // el reloj del ciclo de vida manualmente: sella cuándo vence este período
    // Premium para que el cron license-lifecycle sepa cuándo empezar a contar.
    if (cfg.lifecycle?.periodEndField && cfg.lifecycle.paidPlanValues?.includes(plan)) {
      const when = now ? new Date(now) : new Date()
      const periodEnd = new Date(when.getTime())
      periodEnd.setUTCDate(periodEnd.getUTCDate() + 30)
      patch[cfg.lifecycle.periodEndField] = periodEnd.toISOString()
    }
  } else if (op === 'confirm_payment') {
    const b = cfg.billing
    if (!b) return { error: `${appId} no soporta confirmación de pago` }
    const months = Number(periodMonths) || 1
    const when = now ? new Date(now) : new Date()
    // La renovación automática (cobro MP el día 1) fuerza 'first_of_month' para que
    // el vencimiento caiga siempre el 1° del mes siguiente, sin importar el
    // dayConvention normal del app.
    const dayConvention = dayConventionOverride || b.dayConvention
    newExpiry = computeRenewalExpiry({ currentExpiry, periodMonths: months, dateFormat: b.dateFormat, dayConvention, now: when })
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
  } else if (op === 'set_addon') {
    // Confirma/activa un add-on del plan de cobro (implementación asistida,
    // soporte prioritario) tras validar el pago manualmente — ver cfg.addons.
    const addonCfg = cfg.addons?.[addonKey]
    if (!addonCfg) return { error: `addon inválido para ${appId}: ${addonKey}` }
    if (!addonCfg.values.some((v) => v === addonValue)) {
      return { error: `valor inválido para addon ${addonKey} en ${appId}: ${JSON.stringify(addonValue)}` }
    }
    patch[addonCfg.field] = addonValue
    const stampField = addonCfg.stampField?.[addonValue]
    if (stampField) patch[stampField] = (now ? new Date(now) : new Date()).toISOString()
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
