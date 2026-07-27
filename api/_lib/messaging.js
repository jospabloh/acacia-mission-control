// Messaging engine for the Comunicados pillar. One channel (acaciaControl →
// emails.sendFollowup) serves three message types — renovación, campaña,
// mantenimiento — to one tenant or many. Per-app config gives the display name,
// the value phrase (no customer data, just what the app facilitates), and how to
// resolve recipient emails (license-entity fields or a related membership/school).

export const APP_MSG = {
  flowfin: {
    name: 'FlowFin', entity: 'Family', value: 'tus finanzas familiares organizadas',
    recipient: { related: { entity: 'FamilyMembership', keyField: 'family_id', keyFromRecord: 'id', emailField: 'user_email', roleField: 'role', roles: ['owner', 'admin'] }, nameField: 'name' },
    log: { entity: 'EmailNotification', idField: 'family_id' },
  },
  stockflow: {
    name: 'StockFlow', entity: 'Business', value: 'tu inventario y tus ventas al día',
    recipient: { related: { entity: 'User', keyField: 'business_id', keyFromRecord: 'id', emailField: 'email', roleField: 'role', roles: ['owner', 'admin'] }, nameField: 'name' },
    log: { entity: 'EmailNotification', idField: 'business_id' },
  },
  radar: {
    name: 'Radar', entity: 'Company', value: 'la asistencia de tu equipo bajo control',
    recipient: { related: { entity: 'User', keyField: 'company_id', keyFromRecord: 'id', emailField: 'email', roleField: 'app_role', roles: ['company_admin'] }, nameField: 'name' },
  },
  rumbo: {
    name: 'Rumbo', entity: 'TenantLicense', value: 'tu flota y tus viajes bajo control',
    recipient: { fields: ['owner_email'], nameField: 'tenant_name' },
  },
  liuma: {
    name: 'LIUMA', entity: 'SchoolSubscription', value: 'tu escuela conectada con las familias',
    recipient: { related: { entity: 'School', keyField: 'id', keyFromRecord: 'school_id', emailField: 'email' } },
  },
  puntos: {
    name: 'Puntos+', entity: 'Business', value: 'tu programa de lealtad activo',
    recipient: { fields: ['contact_email', 'owner_email'], nameField: 'name' },
  },
  cateqhub: {
    name: 'CateqHub', entity: 'Parish', value: 'la asistencia y el catecismo de tu parroquia al día',
    recipient: { related: { entity: 'User', keyField: 'parish_id', keyFromRecord: 'id', emailField: 'email', roleField: 'parish_role', roles: ['admin'] }, nameField: 'name' },
  },
}

export function messagingFor(appId) { return APP_MSG[appId] ?? null }

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
function paras(text) {
  return String(text ?? '').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
}
function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ACACIA-branded shell — clean, paper/ink, no per-tenant data unless passed in.
function wrap(appName, content) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f6f2;margin:0;padding:20px;color:#2a2a33;line-height:1.7}
.card{max-width:560px;margin:0 auto;background:#fff;border:1px solid #ece9e1;border-radius:16px;overflow:hidden}
.hd{padding:24px 28px;border-bottom:1px solid #f0eee7}.hd b{font-size:16px;color:#0e0d14}.hd span{color:#8a8780;font-size:12px}
.bd{padding:24px 28px}.bd p{margin:0 0 14px}.hi{color:#3b6ef8;font-weight:600}
.ft{padding:16px 28px;background:#faf9f6;border-top:1px solid #f0eee7;font-size:12px;color:#9b988f}
.ft a{color:#3b6ef8;text-decoration:none}</style></head><body>
<div class="card"><div class="hd"><b>${esc(appName)}</b><br><span>por ACACIA Consultoría</span></div>
<div class="bd">${content}</div>
<div class="ft">${esc(appName)} — desarrollado por <b>ACACIA</b><br>
<a href="mailto:soporte@acaciaco.com.mx">soporte@acaciaco.com.mx</a> · WhatsApp</div></div></body></html>`
}

// Render { subject, html } for a message type. ctx: { app(cfg), tenantName,
// date, days, subject, body, maint:{ date, time, duration } }.
export function renderMessage(type, ctx) {
  const app = ctx.app
  const hello = ctx.tenantName ? `Hola <span class="hi">${esc(ctx.tenantName)}</span>,` : 'Hola,'

  if (type === 'renewal') {
    const when = ctx.date ? `el <strong>${fmtDate(ctx.date)}</strong>${ctx.days != null ? ` (en ${ctx.days} días)` : ''}` : 'pronto'
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}renueva tu licencia de ${app.name} y sigue sin interrupciones 🌿`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Sabemos lo importante que es <span class="hi">${esc(app.name)}</span> en tu día a día — para mantener <strong>${esc(app.value)}</strong> sin complicaciones. Queremos que sigas aprovechándolo sin pausas.</p>
<p>Tu licencia vence ${when}. Renovar toma un minuto: escríbele a tu ejecutivo ACACIA o responde este correo y lo dejamos listo.</p>
<p>Aquí estamos para lo que necesites.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'payment_confirmed') {
    // Agradecimiento tras confirmar un pago: la licencia queda activa por el
    // período pagado. Se dispara al presionar "Confirmar pago" (opcional).
    const months = Number(ctx.periodMonths) || 1
    const periodo = months === 12 ? 'un año' : months === 1 ? 'un mes' : `${months} meses`
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}¡gracias! Tu licencia de ${app.name} está activa ✅`,
      html: wrap(app.name, `<p>${hello}</p>
<p>¡Recibimos tu pago, gracias! 🌿 Tu licencia de <span class="hi">${esc(app.name)}</span> quedó <strong>activa</strong> y <strong>${esc(app.value)}</strong> sigue sin interrupciones.</p>
<p>Renovaste por <strong>${periodo}</strong>${ctx.date ? `: tu licencia es válida hasta el <strong>${fmtDate(ctx.date)}</strong>` : ''}.</p>
${ctx.reference ? `<p style="color:#8a8780;font-size:13px">Referencia de pago: <strong>${esc(ctx.reference)}</strong></p>` : ''}
<p>Cualquier duda, respóndenos este correo o escríbele a tu ejecutivo ACACIA. Gracias por seguir con nosotros.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'renewal_fyi') {
    // Personal heads-up for tenants ON a recurring plan: the Mercado Pago charge
    // runs automatically on the 1st — nothing for them to do. Reassuring, FYI tone.
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}tu plan de ${app.name} se renueva solo el día 1 ✅`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Solo un aviso rápido y personal: tu plan de <span class="hi">${esc(app.name)}</span> tiene <strong>cobro automático en Mercado Pago</strong>, así que el <strong>día 1</strong> se renueva solo. No necesitas hacer nada — <strong>${esc(app.value)}</strong> sigue sin interrupciones.</p>
${ctx.date ? `<p>Tu siguiente período queda cubierto hasta el <strong>${fmtDate(ctx.date)}</strong>.</p>` : ''}
<p>Si en algún momento quieres revisar tu plan o tu método de pago, respóndenos este correo y con gusto te ayudamos.</p>
<p>Gracias por seguir con nosotros.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'trial_offer') {
    // For tenants NOT on a plan (trial ended / never subscribed): invite them to
    // subscribe. Mercado Pago handles the recurring charge once they activate.
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}activa tu plan de ${app.name} y sigue sin límites 🌿`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Esperamos que <span class="hi">${esc(app.name)}</span> te haya sido útil. Para seguir aprovechando <strong>${esc(app.value)}</strong> sin interrupciones, te invitamos a <strong>activar tu plan</strong>.</p>
<p>La suscripción es mensual por <strong>Mercado Pago</strong>: se activa al instante y se renueva sola cada mes (la cancelas cuando quieras).</p>
${ctx.body ? paras(ctx.body) : ''}
<p>¿Lista/o para activarlo? Responde este correo o escríbele a tu ejecutivo ACACIA y lo dejamos andando hoy mismo.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'maintenance') {
    const m = ctx.maint ?? {}
    const win = [m.date && fmtDate(m.date), m.time && `a las ${esc(m.time)}`, m.duration && `(~${esc(m.duration)})`].filter(Boolean).join(' ')
    return {
      subject: `Mantenimiento programado de ${app.name}`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Te avisamos que <span class="hi">${esc(app.name)}</span> tendrá una ventana de <strong>mantenimiento programado</strong>${win ? ` ${win}` : ''}. Durante ese lapso el servicio podría no estar disponible por momentos.</p>
${ctx.body ? paras(ctx.body) : ''}
<p>Gracias por tu comprensión — lo hacemos para que <strong>${esc(app.value)}</strong> siga funcionando mejor.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'premium_read_only') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}Tutores en ${app.name} está en modo solo lectura`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Tu plan Premium de <span class="hi">${esc(app.name)}</span> está pendiente de pago. Por ahora, <strong>agregar o editar Tutores</strong> quedó pausado — lo que ya registraste sigue visible sin cambios.</p>
<p>El resto de ${esc(app.name)} (niños, grupos, asistencia) sigue funcionando normalmente, sin ninguna restricción.</p>
<p>Confirma tu pago cuando puedas para reactivar Tutores. Cualquier duda, respóndenos este correo.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'premium_access_denied') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}acceso a Tutores denegado en ${app.name} — exporta tus datos`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Por falta de pago prolongada, el acceso a <strong>Tutores</strong> en <span class="hi">${esc(app.name)}</span> quedó denegado. El resto de la app (niños, grupos, asistencia) sigue funcionando normalmente.</p>
<p>Puedes <strong>exportar (descargar) tus datos de Tutores</strong> directamente desde la pantalla de Premium dentro de ${esc(app.name)}, antes de que se eliminen. Solo tú, como administrador de tu parroquia, puedes hacerlo.</p>
<p>Si confirmas tu pago, tu acceso se reactiva de inmediato.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'premium_read_only_reminder') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}recordatorio: Tutores sigue en solo lectura en ${app.name}`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Solo un recordatorio: tu plan Premium de <span class="hi">${esc(app.name)}</span> sigue pendiente de pago, así que Tutores continúa en modo solo lectura.</p>
<p>Confirma tu pago cuando puedas para reactivarlo sin perder nada de lo ya registrado.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'premium_access_denied_reminder') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}recordatorio: exporta tus datos de Tutores en ${app.name}`,
      html: wrap(app.name, `<p>${hello}</p>
<p>El acceso a Tutores en <span class="hi">${esc(app.name)}</span> sigue denegado por falta de pago. Te recordamos que puedes <strong>descargar tus datos</strong> desde la pantalla de Premium antes de que se eliminen.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'premium_data_deleted_confirmation') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}tus datos de Tutores en ${app.name} fueron eliminados`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Confirmamos que los datos de <strong>Tutores</strong> de tu parroquia en <span class="hi">${esc(app.name)}</span> fueron eliminados de la plataforma, tras haber confirmado tu exportación. El resto de tu información (niños, grupos, asistencia) no fue afectado.</p>
<p>Puedes volver a usar Tutores en cualquier momento activando el plan Premium de nuevo.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  // campaign — operator writes subject + body
  return {
    subject: ctx.subject || `Novedades de ${app.name}`,
    html: wrap(app.name, `<p>${hello}</p>${paras(ctx.body)}<p>— Equipo <strong>ACACIA</strong></p>`),
  }
}
