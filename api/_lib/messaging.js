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
  ctrlhq: {
    name: 'CtrlHQ', entity: 'Business', value: 'tu operación y tus finanzas bajo control',
    recipient: { related: { entity: 'User', keyField: 'business_id', keyFromRecord: 'id', emailField: 'email', roleField: 'role', roles: ['admin'] }, nameField: 'name' },
    // No `log` — CtrlHQ has no EmailNotification-equivalent entity yet (unlike
    // stockflow/flowfin). Reminder de-duplication still works (Mission Control's
    // own license_lifecycle_reminders table is what actually prevents double
    // sends); this only means the send isn't ALSO logged inside CtrlHQ itself.
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
    // days puede llegar negativo (licencia ya vencida — el sweep del día 1 la
    // atrapa aunque haya vencido semanas antes). "vence... (en -31 días)" lee
    // como un bug; separamos vencida (venció, hace N días) de por vencer
    // (vence, en N días) para que el correo siempre sea claro.
    const overdue = ctx.days != null && ctx.days < 0
    const plural = (n) => `${n} día${n === 1 ? '' : 's'}`
    const when = ctx.date
      ? overdue
        ? `venció el <strong>${fmtDate(ctx.date)}</strong> (hace ${plural(Math.abs(ctx.days))})`
        : `vence el <strong>${fmtDate(ctx.date)}</strong>${ctx.days != null ? ` (en ${plural(ctx.days)})` : ''}`
      : 'vence pronto'
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}renueva tu licencia de ${app.name} y sigue sin interrupciones 🌿`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Sabemos lo importante que es <span class="hi">${esc(app.name)}</span> en tu día a día — para mantener <strong>${esc(app.value)}</strong> sin complicaciones. Queremos que sigas aprovechándolo sin pausas.</p>
<p>Tu licencia ${when}. Renovar toma un minuto: escríbele a tu ejecutivo ACACIA o responde este correo y lo dejamos listo.</p>
<p>Aquí estamos para lo que necesites.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'renewal_upcoming') {
    // Aviso previo (T-7 días), antes de que la licencia venza — para pago
    // manual únicamente (quien tiene cobro automático ya tiene su propio
    // aviso el día 1). Tono de heads-up, no de urgencia: todavía falta.
    const days = Number(ctx.days) || 0
    const plural = (n) => `${n} día${n === 1 ? '' : 's'}`
    const when = ctx.date ? `el <strong>${fmtDate(ctx.date)}</strong>` : 'pronto'
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}tu licencia de ${app.name} vence en ${plural(days)} 🗓️`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Un aviso con tiempo: tu licencia de <span class="hi">${esc(app.name)}</span> vence ${when} (en ${plural(days)}). Todavía no pasa nada — solo queremos que no te agarre de sorpresa.</p>
<p>Cuando quieras renovar, escríbele a tu ejecutivo ACACIA o responde este correo y lo dejamos listo, para que <strong>${esc(app.value)}</strong> siga sin interrupciones.</p>
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

  if (type === 'usage_reminder') {
    // Recordatorio de uso — motivacional, sin culpa. Nunca menciona licencia,
    // vencimiento ni riesgo de nada: es una invitación, no una advertencia.
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}hace tiempo que no te vemos por ${app.name} 🌱`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Notamos que hace un tiempo no entras a <span class="hi">${esc(app.name)}</span> — nada cambió, todo sigue tal como lo dejaste. Solo queríamos avisarte que seguimos aquí, listos para ayudarte con <strong>${esc(app.value)}</strong>.</p>
<p>Si algo no te quedó claro o hay algo que podamos mejorar, respóndenos este correo — nos encantaría saber cómo te fue.</p>
<p>Te esperamos de vuelta cuando quieras.</p>
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
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}${app.name} está en modo solo lectura`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Tu período de prueba o pago de <span class="hi">${esc(app.name)}</span> venció y no se ha renovado. Por ahora, <strong>agregar o editar quedó pausado en toda la app</strong> (asistencia, niños, grupos, reportes y Tutores) — lo que ya registraste sigue visible sin cambios.</p>
<p>Confirma tu pago cuando puedas para reactivar la app por completo. Cualquier duda, respóndenos este correo.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'premium_access_denied') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}acceso denegado en ${app.name} — exporta tus datos de Tutores`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Por falta de pago prolongada, el acceso a <span class="hi">${esc(app.name)}</span> quedó denegado por completo: asistencia, niños, grupos, reportes y Tutores. Tus datos de niños, grupos y asistencia <strong>no se eliminan</strong> — quedan pausados hasta reactivar el plan.</p>
<p>Puedes <strong>exportar (descargar) tus datos de Tutores</strong> directamente desde la pantalla de Premium dentro de ${esc(app.name)}, antes de que se eliminen. Solo tú, como administrador de tu parroquia, puedes hacerlo.</p>
<p>Si confirmas tu pago, tu acceso se reactiva de inmediato.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'premium_read_only_reminder') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}recordatorio: ${app.name} sigue en solo lectura`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Solo un recordatorio: tu período de prueba o pago de <span class="hi">${esc(app.name)}</span> sigue vencido, así que la app continúa en modo solo lectura.</p>
<p>Confirma tu pago cuando puedas para reactivarla sin perder nada de lo ya registrado.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'premium_access_denied_reminder') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}recordatorio: exporta tus datos de Tutores en ${app.name}`,
      html: wrap(app.name, `<p>${hello}</p>
<p>El acceso a ${esc(app.name)} sigue denegado por falta de pago. Te recordamos que puedes <strong>descargar tus datos de Tutores</strong> desde la pantalla de Premium antes de que se eliminen — el resto de tu información no se borra.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'premium_data_deleted_confirmation') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}tus datos de Tutores en ${app.name} fueron eliminados`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Confirmamos que los datos de <strong>Tutores</strong> de tu parroquia en <span class="hi">${esc(app.name)}</span> fueron eliminados de la plataforma, tras haber confirmado tu exportación. El resto de tu información (niños, grupos, asistencia) no fue afectado, y tu parroquia queda en el plan Gratis: asistencia, niños, grupos/libros y reportes siguen funcionando sin vencimiento.</p>
<p>Puedes volver a usar Tutores, mensajería, tareas y pulseras en cualquier momento activando el plan Premium de nuevo.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'trial_ended_downgraded_free') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}tu prueba Premium de ${app.name} terminó — sigues en el plan Gratis`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Tu prueba Premium de <span class="hi">${esc(app.name)}</span> de 30 días terminó. Como tu parroquia tiene 50 niños activos o menos, no se pausó nada: sigues en el <strong>plan Gratis</strong>, sin vencimiento — asistencia por QR, niños, grupos/libros y reportes siguen funcionando igual.</p>
<p>Lo único que ya no está disponible es <strong>Tutores, mensajería, tareas y pulseras</strong> (funciones Premium). Si ya cargaste tutores, siguen visibles y los puedes eliminar cuando quieras; para volver a agregarlos hay que activar Premium.</p>
<p>¿Quieres seguir con Premium? Responde este correo o escríbele a tu ejecutivo ACACIA.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'license_read_only') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}${app.name} está en modo solo lectura`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Tu licencia de <span class="hi">${esc(app.name)}</span> venció y no se ha renovado. Por ahora, <strong>agregar o editar quedó pausado</strong> — lo que ya registraste sigue visible sin cambios.</p>
<p>Confirma tu pago cuando puedas para reactivar la app por completo. Cualquier duda, escríbenos a soporte.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'license_blocked') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}acceso bloqueado en ${app.name} — falta de pago prolongada`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Por falta de pago prolongada, el acceso a <span class="hi">${esc(app.name)}</span> quedó bloqueado por completo. Tus datos <strong>no se eliminan</strong> — quedan pausados hasta reactivar tu licencia.</p>
<p>Si necesitas exportar tu información antes de reactivar, escríbenos a soporte y te la enviamos.</p>
<p>Si confirmas tu pago, tu acceso se reactiva de inmediato.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  if (type === 'license_inactive_warning') {
    return {
      subject: `${ctx.tenantName ? ctx.tenantName + ', ' : ''}última oportunidad antes de perder tus datos en ${app.name}`,
      html: wrap(app.name, `<p>${hello}</p>
<p>Tu licencia de <span class="hi">${esc(app.name)}</span> sigue sin renovarse desde hace tiempo. Tu cuenta está a punto de pasar a inactiva — si esto continúa, tus datos serán elegibles para eliminación.</p>
<p>Confirma tu pago o escríbenos a soporte para evitarlo — todavía estás a tiempo de recuperar el acceso sin perder nada.</p>
<p>— Equipo <strong>ACACIA</strong></p>`),
    }
  }

  // campaign — operator writes subject + body
  return {
    subject: ctx.subject || `Novedades de ${app.name}`,
    html: wrap(app.name, `<p>${hello}</p>${paras(ctx.body)}<p>— Equipo <strong>ACACIA</strong></p>`),
  }
}
