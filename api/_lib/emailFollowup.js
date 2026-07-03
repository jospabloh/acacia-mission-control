// Envío de correos de seguimiento (comunicados) por el puente acaciaControl →
// emails.sendFollowup. Extrae la lógica común que comparten el endpoint manual
// (send-message / list-contacts) y los envíos automáticos (cron de recordatorios,
// agradecimiento al confirmar pago), para no duplicarla.
//
// SERVER ONLY — usa el puente HMAC. Nunca importar desde src/.
import { supabaseAdmin } from './supabaseAdmin.js'
import { callBridge } from './appBridge.js'
import { renderMessage } from './messaging.js'

// Resuelve los contactos destinatarios de un app: [{ id, name, email }] con
// email. Nombres se enriquecen desde la tabla tenants cuando el registro de
// licencia no trae uno. `cfg` es el messagingFor(appId).
export async function resolveRecipients(app, cfg) {
  const out = await callBridge(app, 'tenants.contacts', { entity: cfg.entity, recipient: cfg.recipient })
  const contacts = out?.contacts ?? out?.data?.contacts ?? []

  const { data: tenants } = await supabaseAdmin.from('tenants').select('external_id, name').eq('app_id', app.id)
  const nameByExt = Object.fromEntries((tenants ?? []).map((t) => [t.external_id, t.name]))

  return contacts
    .filter((c) => c.email)
    .map((c) => ({ id: c.id, email: c.email, name: c.name || nameByExt[c.id] || null }))
}

// Renderiza y envía un correo de seguimiento a un destinatario. Construye el
// `log` del app cuando cfg.log está definido y hay un id de registro.
// Devuelve { sent:true } o { error }. No lanza — el llamador decide qué hacer.
export async function sendFollowup(app, cfg, type, recipient, ctx = {}) {
  if (!recipient?.email) return { error: 'sin email' }
  const { subject, html } = renderMessage(type, { app: cfg, tenantName: recipient.name, ...ctx })

  const log = cfg.log && recipient.id
    ? { entity: cfg.log.entity, row: {
        [cfg.log.idField]: recipient.id, email_type: `mc_${type}`, recipient_email: recipient.email,
        status: 'sent', notification_key: `mc:${type}:${recipient.id}:${new Date().toISOString().slice(0, 10)}`,
      } }
    : undefined

  try {
    await callBridge(app, 'emails.sendFollowup', { to: recipient.email, subject, html, log })
    return { sent: true }
  } catch (e) {
    return { error: e.message }
  }
}
