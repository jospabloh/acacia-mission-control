// Internal "nuevo testimonio por revisar" e-mail, same audience and shape as the
// new-ticket alert (ticketAlert.js). ctx: { appName, tenantName, rating,
// body, authorName, authorRole, link }
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

export function renderTestimonialAlert(ctx) {
  const stars = '★'.repeat(ctx.rating) + '☆'.repeat(5 - ctx.rating)
  const subject = `⭐ [${ctx.appName}] Testimonio por revisar (${ctx.rating}/5)`
  const who = [ctx.authorName, ctx.authorRole].filter(Boolean).join(' · ')
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#2a2a33">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a8780">ACACIA Mission Control · ${esc(ctx.appName)}</p>
  <p style="margin:0 0 10px;font-size:16px;font-weight:600;color:#0e0d14">Nuevo testimonio por revisar</p>
  <p style="margin:0 0 10px;font-size:20px;color:#d97706;letter-spacing:2px">${stars}</p>
  <div style="border-left:3px solid #3b6ef8;background:#f6f5f2;border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(ctx.body)}</div>
  <p style="margin:12px 0 0;font-size:13px;color:#8a8780">${esc(who)}${ctx.tenantName ? ` — ${esc(ctx.tenantName)}` : ''}</p>
  ${ctx.link ? `<p style="margin:18px 0 0"><a href="${esc(ctx.link)}" style="color:#3b6ef8;font-weight:600">Revisar en Mission Control</a></p>` : ''}
</div>`
  return { subject, html }
}
