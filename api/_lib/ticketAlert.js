// Renders the internal "nuevo ticket de soporte" alert email that Mission
// Control fires the instant a customer raises a ticket (api/_lib/ingest/ticket.js).
// This is an OPERATIONS notice to the ACACIA support desk — not a customer
// message — so it leads with the system ticket id, the SLA deadline, and every
// field an operator needs to triage without opening anything: app, requester,
// issue, category, priority.

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function fmtWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City',
  })
}

const PRIO_LABEL = { urgent: 'Urgente', high: 'Alta', normal: 'Normal', low: 'Baja' }
const PRIO_COLOR = { urgent: '#dc2626', high: '#d97706', normal: '#3b6ef8', low: '#6b7280' }

function row(label, value) {
  if (value == null || value === '') return ''
  return `<tr><td style="padding:6px 0;color:#8a8780;font-size:13px;width:130px;vertical-align:top">${esc(label)}</td>
<td style="padding:6px 0;color:#2a2a33;font-size:14px;font-weight:500">${esc(value)}</td></tr>`
}

// ctx: { appName, ticketId, subject, issue, category, requesterName, requesterEmail,
//        priority (normalized tier), createdAt, firstResponseDueAt, resolveDueAt, link }
export function renderTicketAlert(ctx) {
  const prio = String(ctx.priority ?? 'normal').toLowerCase()
  const prioLabel = PRIO_LABEL[prio] ?? ctx.priority ?? '—'
  const prioColor = PRIO_COLOR[prio] ?? '#3b6ef8'
  const requester = [ctx.requesterName, ctx.requesterEmail].filter(Boolean).join(' · ') || '—'

  const subject = `🎫 [${ctx.appName}] ${ctx.ticketId} — ${ctx.subject || 'Nuevo ticket de soporte'} (${prioLabel})`

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f6f2;margin:0;padding:20px;color:#2a2a33;line-height:1.6">
<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #ece9e1;border-radius:16px;overflow:hidden">
  <div style="padding:18px 24px;border-bottom:1px solid #f0eee7;display:flex;align-items:center;justify-content:space-between">
    <div><b style="font-size:15px;color:#0e0d14">Nuevo ticket de soporte</b><br>
    <span style="color:#8a8780;font-size:12px">ACACIA Mission Control · ${esc(ctx.appName)}</span></div>
    <span style="background:${prioColor};color:#fff;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px">${esc(prioLabel)}</span>
  </div>
  <div style="padding:20px 24px">
    <div style="font-size:12px;color:#8a8780;letter-spacing:.04em;text-transform:uppercase">Folio</div>
    <div style="font-size:22px;font-weight:700;color:#0e0d14;margin:2px 0 2px">${esc(ctx.ticketId)}</div>
    ${ctx.externalId && String(ctx.externalId) !== String(ctx.ticketId) ? `<div style="font-size:11px;color:#b3b0a7;margin:0 0 16px">ref. ${esc(ctx.externalId)}</div>` : '<div style="margin-bottom:14px"></div>'}
    <table style="width:100%;border-collapse:collapse">
      ${row('App', ctx.appName)}
      ${row('Asunto', ctx.subject)}
      ${row('Usuario', requester)}
      ${row('Categoría', ctx.category)}
      ${row('Prioridad', prioLabel)}
      ${row('Creado por el cliente', fmtWhen(ctx.createdAt))}
      ${row('SLA — 1ra respuesta', fmtWhen(ctx.firstResponseDueAt))}
      ${row('SLA — resolución', fmtWhen(ctx.resolveDueAt))}
    </table>
    ${ctx.issue ? `<div style="margin-top:16px;padding:14px 16px;background:#faf9f6;border:1px solid #f0eee7;border-radius:10px">
      <div style="font-size:12px;color:#8a8780;margin-bottom:6px">Descripción del cliente</div>
      <div style="font-size:14px;white-space:pre-wrap">${esc(ctx.issue)}</div></div>` : ''}
    ${ctx.link ? `<div style="margin-top:20px">
      <a href="${esc(ctx.link)}" style="display:inline-block;background:#0e0d14;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:10px">Abrir en Mission Control →</a>
    </div>` : ''}
  </div>
  <div style="padding:14px 24px;background:#faf9f6;border-top:1px solid #f0eee7;font-size:12px;color:#9b988f">
    El reloj del SLA corre desde que el cliente creó el ticket. Notificación automática de ACACIA Mission Control.
  </div>
</div></body></html>`

  return { subject, html }
}

// Internal notice that a customer answered on a ticket support already knew
// about (apps with notifyCustomerReplies, today sommel). Same audience as the
// new-ticket alert; it quotes the reply so nobody has to open the panel to read it.
// ctx: { appName, ticketId, subject, requesterName, reply, repliedAt, link }
export function renderReplyAlert(ctx) {
  const subject = `💬 [${ctx.appName}] ${ctx.ticketId} — Respondió el cliente: ${ctx.subject || 'ticket de soporte'}`
  const body = esc(ctx.reply).replace(/\r?\n/g, '<br>')
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#2a2a33">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a8780">ACACIA Mission Control · ${esc(ctx.appName)}</p>
  <p style="margin:0 0 14px;font-size:16px;font-weight:600;color:#0e0d14">El cliente respondió en un ticket</p>
  <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
    ${row('Folio', ctx.ticketId)}
    ${row('Asunto', ctx.subject)}
    ${row('Quién', ctx.requesterName)}
    ${row('Cuándo', fmtWhen(ctx.repliedAt))}
  </table>
  <div style="border-left:3px solid #3b6ef8;background:#f6f5f2;border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.55">${body}</div>
  ${ctx.link ? `<p style="margin:18px 0 0"><a href="${esc(ctx.link)}" style="color:#3b6ef8;font-weight:600">Abrir en Soporte</a></p>` : ''}
</div>`
  return { subject, html }
}
