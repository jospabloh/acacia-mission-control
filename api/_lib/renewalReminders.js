// Lógica pura del recordatorio mensual (día 1). Sin imports ni efectos, para que
// sea trivialmente testeable (renewalReminders.test.js). El orquestador que toca
// bodega + puente vive en api/cron/renewal-reminders.js.
//
// Reglas de negocio:
//   auto_renew = false → 'renewal'      (recordatorio amable de pago)
//   auto_renew = true  → 'renewal_fyi'  (aviso de cargo automático el día 1)
//   califican las licencias vencidas o por vencer dentro del mes en curso.

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
