// Qué puede hacerse con la licencia de cada app, para el panel.
//
// Espejo literal de `licenseCapabilities()` en api/_lib/licenseControl.js — el
// cliente no puede importar código de servidor (regla de CLAUDE.md), así que la
// copia vive aquí y `licenseCatalog.test.js` falla si las dos se separan. Antes
// había tres mirrors sueltos dentro de Licences.jsx (PLANS, HAS_VIEW_ONLY,
// HAS_BILLING) y ya se habían desincronizado: rumbo llevaba `view_only`
// desplegado desde 2026-08-03 y el panel seguía sin ofrecerlo, y radar no
// aparecía en ninguno de los tres, así que sus licencias salían sin un solo
// control. Un solo lugar, con prueba.
//
// `statuses` son los valores tal como quedan guardados en la app (cateqhub usa
// read_only/access_denied), que es contra lo que se compara `license.status` de
// la bodega para saber en qué estado está ya el tenant.
export const LICENSE_CATALOG = {
  flowfin: {
    plans: ['home', 'family_plus', 'circle', 'founder'],
    statuses: { active: 'active', suspend: 'suspended', view_only: 'view_only', cancel: 'suspended' },
    hasBilling: true, hasViewOnly: true, hasExpiry: true, hasTrial: true,
    dateFormat: 'datetime', dayConvention: 'first_of_month', addons: [],
  },
  stockflow: {
    plans: ['start', 'growth', 'pro', 'founder'],
    statuses: { active: 'active', suspend: 'suspended', view_only: 'view_only', cancel: 'suspended' },
    hasBilling: true, hasViewOnly: true, hasExpiry: true, hasTrial: true,
    dateFormat: 'datetime', dayConvention: 'preserve_day', addons: [],
  },
  radar: {
    plans: ['starter', 'pro', 'enterprise', 'founder'],
    statuses: { active: 'active', suspend: 'suspended', view_only: 'view_only', cancel: 'suspended' },
    hasBilling: true, hasViewOnly: true, hasExpiry: true, hasTrial: false,
    dateFormat: 'date', dayConvention: 'preserve_day', addons: [],
  },
  rumbo: {
    plans: ['trial', 'starter', 'pro', 'enterprise', 'founder'],
    statuses: { active: 'active', suspend: 'suspended', view_only: 'view_only', cancel: 'cancelled' },
    hasBilling: true, hasViewOnly: true, hasExpiry: true, hasTrial: true,
    dateFormat: 'date', dayConvention: 'preserve_day', addons: [],
  },
  liuma: {
    plans: ['start', 'growth', 'plus', 'founder'],
    statuses: { active: 'active', suspend: 'suspended', view_only: 'view_only', cancel: 'suspended' },
    hasBilling: true, hasViewOnly: true, hasExpiry: true, hasTrial: true,
    dateFormat: 'datetime', dayConvention: 'first_of_month', addons: [],
  },
  puntos: {
    plans: ['starter', 'growth', 'pro', 'enterprise', 'founder'],
    statuses: { active: 'active', suspend: 'suspended', view_only: 'view_only', cancel: 'suspended' },
    hasBilling: true, hasViewOnly: true, hasExpiry: true, hasTrial: true,
    dateFormat: 'datetime', dayConvention: 'preserve_day', addons: [],
  },
  ctrlhq: {
    plans: ['pro'],
    statuses: { active: 'active', suspend: 'suspended', view_only: 'view_only', cancel: 'suspended' },
    hasBilling: true, hasViewOnly: true, hasExpiry: true, hasTrial: true,
    dateFormat: 'datetime', dayConvention: 'preserve_day', addons: [],
  },
  kitchops: {
    plans: ['start', 'growth', 'pro'],
    statuses: { active: 'active', suspend: 'suspended', view_only: 'view_only', cancel: 'suspended' },
    hasBilling: true, hasViewOnly: true, hasExpiry: true, hasTrial: true,
    dateFormat: 'datetime', dayConvention: 'preserve_day', addons: [],
  },
  cateqhub: {
    plans: ['premium'],
    statuses: { active: 'active', suspend: 'access_denied', view_only: 'read_only', cancel: 'access_denied' },
    // Premium se cobra a mano (sin Mercado Pago), así que no hay "Confirmar
    // pago"; el vencimiento (premium_period_end_at) sí se edita a mano.
    hasBilling: false, hasViewOnly: true, hasExpiry: true, hasTrial: false,
    dateFormat: 'datetime', dayConvention: null, addons: ['implementation', 'support_priority'],
  },
  artiskids: {
    plans: ['recuerdos'],
    statuses: { active: 'active', suspend: 'suspended', view_only: 'view_only', cancel: 'suspended' },
    hasBilling: true, hasViewOnly: true, hasExpiry: true, hasTrial: true,
    dateFormat: 'datetime', dayConvention: 'preserve_day', addons: [],
  },
  // Sin planes todavía: los nombres están por decidir (ver licenseControl.js).
  sommel: {
    plans: [],
    statuses: { active: 'active', suspend: 'suspended', view_only: 'view_only', cancel: 'suspended' },
    hasBilling: true, hasViewOnly: true, hasExpiry: true, hasTrial: true,
    dateFormat: 'datetime', dayConvention: 'preserve_day', addons: [],
  },
}

// `null` para una app sin control de licencia (freeware, sitios, apps sin
// puente): sus renglones se muestran igual, en solo lectura.
export function capabilitiesFor(appId) {
  return LICENSE_CATALOG[appId] ?? null
}

const DAY = 86_400_000

// Umbrales del ciclo de vida unificado del portafolio (api/_lib/licenseControl.js
// `lifecycle`, idénticos en las 9 apps): días vencido → etapa. La barra de
// vencimiento de cada renglón dibuja exactamente esta escala.
export const LIFECYCLE_STAGES = [
  { key: 'grace', days: 0, label: 'Gracia', hint: 'Vencida, todavía con acceso completo' },
  { key: 'read_only', days: 8, label: 'Solo lectura', hint: 'Día 8: el cron la pasa a solo lectura' },
  { key: 'blocked', days: 15, label: 'Bloqueada', hint: 'Día 15: el cron corta el acceso' },
  { key: 'inactive', days: 30, label: 'Inactiva', hint: 'Día 30: se marca inactiva' },
  { key: 'deletion', days: 45, label: 'Borrable', hint: 'Día 45: elegible para borrado de datos' },
]

// Cuántos días lleva vencida (negativo = todavía no vence) y en qué etapa del
// ciclo la dejaría el cron hoy. `null` cuando no hay fecha que medir.
export function lifecyclePosition(expiry, now = Date.now()) {
  if (!expiry) return null
  const t = new Date(expiry).getTime()
  if (Number.isNaN(t)) return null
  const overdue = Math.floor((now - t) / DAY)
  let stage = null
  for (const s of LIFECYCLE_STAGES) if (overdue >= s.days) stage = s
  return { overdue, stage }
}
