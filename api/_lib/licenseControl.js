// Per-app license-control model. Every Base44 app changes its license by writing
// its license entity as service-role (acaciaControl `license.set`); only the
// field names + enum values differ. Mission Control owns this mapping and builds
// the patch, so the bridge stays generic. Operations are intentionally minimal
// and additive (status / plan), never destructive (no delete/archive here).

const APPS = {
  flowfin: {
    entity: 'Family', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['home', 'family_plus', 'circle'],
  },
  stockflow: {
    entity: 'Business', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['start', 'growth', 'pro'],
  },
  rumbo: {
    entity: 'TenantLicense', statusField: 'status', planField: 'plan',
    statuses: { active: 'active', suspended: 'suspended' }, // suspend auto-blocks write_access
    plans: ['trial', 'starter', 'pro', 'enterprise'],
  },
  liuma: {
    entity: 'SchoolSubscription', statusField: 'subscription_status', planField: 'license_tier',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['start', 'growth', 'plus'],
  },
  puntos: {
    entity: 'Business', statusField: 'billing_status', planField: 'license_plan',
    statuses: { active: 'active', suspended: 'suspended', view_only: 'view_only' },
    plans: ['starter', 'growth', 'pro', 'enterprise'],
    // puntos keeps an append-only LicenseEvent audit; mirror MC actions into it.
    audit: { entity: 'LicenseEvent', idField: 'business_id', eventType: {
      reactivate: 'reactivated', suspend: 'suspended', view_only: 'view_only', set_plan: 'plan_changed',
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
}

// Build the { patch, log } the bridge `license.set` expects for one operation.
// Returns { error } when the op/plan is invalid for the app.
export function buildLicenseChange(appId, op, { plan, actorEmail } = {}) {
  const cfg = APPS[appId]
  if (!cfg) return { error: `app ${appId} no soporta control de licencia` }

  const patch = {}
  let toStatus = null
  if (op === 'reactivate' || op === 'suspend' || op === 'view_only') {
    const val = cfg.statuses[op === 'reactivate' ? 'active' : op]
    if (!val) return { error: `'${op}' no aplica a ${appId}` }
    patch[cfg.statusField] = val
    toStatus = val
  } else if (op === 'set_plan') {
    if (!plan || !cfg.plans.includes(plan)) return { error: `plan inválido para ${appId}: ${plan}` }
    patch[cfg.planField] = plan
  } else {
    return { error: `op desconocida: ${op}` }
  }

  const out = { patch }
  if (cfg.audit) {
    out.log = {
      entity: cfg.audit.entity,
      row: {
        [cfg.audit.idField]: undefined, // filled with the record id by the caller
        event_type: cfg.audit.eventType[op] ?? op,
        to_status: toStatus ?? undefined,
        to_plan: op === 'set_plan' ? plan : undefined,
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
