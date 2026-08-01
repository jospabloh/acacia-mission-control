// Lógica pura del recordatorio mensual (día 1). Sin imports ni efectos, para que
// sea trivialmente testeable (renewalReminders.test.js). El orquestador que toca
// bodega + puente vive en api/cron/renewal-reminders.js.
//
// Reglas de negocio:
//   auto_renew = false → 'renewal'      (recordatorio amable de pago)
//   auto_renew = true  → 'renewal_fyi'  (aviso de cargo automático el día 1)
//   califican las licencias vencidas o por vencer dentro del mes en curso.

const DAY = 86_400_000

// Clave de período 'YYYY-MM' (UTC) del envío.
export function currentPeriodKey(now = new Date()) {
  return now.toISOString().slice(0, 7)
}

// Fin del mes en curso (UTC), como timestamp: primer instante del mes siguiente.
export function endOfMonthUTC(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
}

// ¿La licencia debe recibir recordatorio este mes? Sí cuando tiene expiry y ya
// venció o vence dentro del mes en curso. Futuro lejano → no.
export function qualifiesForReminder(license, now = new Date()) {
  const cpe = license?.current_period_end
  if (!cpe) return false
  const t = new Date(cpe).getTime()
  if (Number.isNaN(t)) return false
  return t < endOfMonthUTC(now)
}

// Qué correo mandar según el modo de cobro del tenant.
export function reminderKindFor(license) {
  return license?.auto_renew ? 'renewal_fyi' : 'renewal'
}

// Estados en los que NO se auto-renueva aunque el tenant tenga cobro automático:
// una baja/pausa hecha a propósito por el operador no debe revivir sola.
const NO_AUTO_STATUS = new Set(['suspended', 'canceled', 'cancelled', 'view_only'])

// ¿Corresponde extender la licencia automáticamente este día 1? Sí cuando está en
// cobro automático y su estado no es una baja/pausa deliberada.
export function shouldAutoRenew(license) {
  if (!license?.auto_renew) return false
  return !NO_AUTO_STATUS.has(String(license.status ?? '').toLowerCase())
}

// ---------------------------------------------------------------------------
// Aviso previo al vencimiento (T-7 días), separado del barrido del día 1.
// Ese barrido solo mira "vencidas o por vencer este mes en curso" — un tenant
// que vence el día 2 no oye nada hasta el día 1 del mes SIGUIENTE (hasta 29
// días de silencio, antes y después de vencer). Este aviso corre a diario y
// cubre el lado "antes": nadie debería enterarse de que su licencia venció
// sin haber recibido antes un heads-up.
//
// Solo aplica a pago manual (auto_renew=false): quien tiene cobro automático
// ya recibe su aviso (renewal_fyi) justo el día 1, cuando Mercado Pago cobra
// — un aviso previo no le suma información, solo ruido.
const UPCOMING_WINDOW_DAYS = 7

// ¿La licencia entra en la ventana de "vence pronto" (hoy..+7 días, sin haber
// vencido aún)? Vencidas quedan fuera — esas ya las cubre el barrido del día 1
// con el aviso de "venció hace N días".
export function qualifiesForUpcomingReminder(license, now = new Date()) {
  if (license?.auto_renew) return false
  const cpe = license?.current_period_end
  if (!cpe) return false
  const t = new Date(cpe).getTime()
  if (Number.isNaN(t)) return false
  const daysUntil = (t - now.getTime()) / DAY
  return daysUntil >= 0 && daysUntil <= UPCOMING_WINDOW_DAYS
}

// Clave de idempotencia: la fecha de vencimiento misma (no el mes), para que
// el aviso salga una sola vez por ciclo de facturación sin importar cuántos
// días corra el cron dentro de la ventana — y para que un renovado (nuevo
// current_period_end) vuelva a calificar en su propio ciclo siguiente.
export function upcomingPeriodKey(license) {
  return new Date(license.current_period_end).toISOString().slice(0, 10)
}
