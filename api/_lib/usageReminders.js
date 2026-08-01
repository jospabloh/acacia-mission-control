// Lógica pura del recordatorio de uso (motivacional). Sin imports ni efectos,
// para que sea trivialmente testeable (usageReminders.test.js). El orquestador
// que toca bodega + puente vive en api/cron/usage-reminders.js.
//
// No hay (todavía) un "último login" que sobreviva más de 24h por app: la
// bodega de sesiones (app_sessions, sync diario) solo guarda sesiones abiertas
// en las últimas 24h — pasado eso, la fila se borra (ver OPEN_WINDOW_MS en
// _lib/sessions.js). Por eso el cron va sellando tenants.last_seen_active_at
// cada vez que ve a un contacto del tenant activo hoy — esa columna sí
// persiste, y es la que esta lógica usa como reloj de inactividad.

const DAY = 86_400_000

// Igual que licenseControl.js: solo 'active' recibe mensajería de producto —
// un tenant en solo lectura / suspendido / acceso denegado ya tiene su propio
// recordatorio de licencia; no tiene sentido invitarlo a "usar más" algo que
// hoy no puede usar.
const BLOCKED_STATUSES = new Set([
  'suspended', 'canceled', 'cancelled', 'view_only', 'access_denied', 'read_only', 'deletion_eligible',
])

const INACTIVITY_DAYS = 21
const MIN_ACCOUNT_AGE_DAYS = 21 // tenant recién llegado: dale tiempo de onboarding antes de invitarlo a "volver"

function daysSince(iso, now) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / DAY
}

// Fecha real de alta del tenant: el created_date de Base44 (dentro de `raw`,
// guardado por el sync) si está; si no, la fecha en que Mission Control lo
// vio por primera vez.
function tenantCreatedAt(tenant) {
  return tenant?.raw?.created_date || tenant?.created_at || null
}

// ¿Corresponde invitar a este tenant a volver a usar la app? Sí cuando su
// licencia está activa, ya pasó su período de gracia de onboarding, y no hay
// actividad reciente (ni sellada por el cron, ni — a falta de eso — desde su
// alta).
export function qualifiesForUsageReminder({ tenant, license, now = new Date() } = {}) {
  const status = String(license?.status ?? '').toLowerCase()
  if (BLOCKED_STATUSES.has(status)) return false

  const createdAt = tenantCreatedAt(tenant)
  const age = daysSince(createdAt, now)
  if (age != null && age < MIN_ACCOUNT_AGE_DAYS) return false

  const reference = tenant?.last_seen_active_at || createdAt
  const idle = daysSince(reference, now)
  if (idle == null) return false // sin ninguna fecha de referencia — no arriesgar

  return idle >= INACTIVITY_DAYS
}

// Clave de período 'YYYY-MM' (UTC): como máximo un recordatorio de uso por
// tenant por mes, para no ser insistentes con quien de plano dejó de usarla.
export function usagePeriodKey(now = new Date()) {
  return now.toISOString().slice(0, 7)
}
