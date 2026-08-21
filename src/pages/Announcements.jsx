import { useState } from 'react'
import { listContacts, sendMessage } from '../lib/control.js'
import { PageHeader } from '../components/PageHeader.jsx'

const MSG_APPS = [
  { id: 'flowfin', name: 'FlowFin' }, { id: 'stockflow', name: 'StockFlow' },
  { id: 'puntos', name: 'Puntos+' }, { id: 'rumbo', name: 'Rumbo' }, { id: 'liuma', name: 'LIUMA' },
]
const TYPES = [
  { id: 'renewal_fyi', label: 'Aviso de cobro (FYI)', hint: 'Para clientes CON plan: aviso personal de que el cobro automático corre el día 1. No tienen que hacer nada.' },
  { id: 'trial_offer', label: 'Ofrecer plan', hint: 'Para clientes SIN plan (trial vencido): invitación a activar su suscripción mensual.' },
  { id: 'renewal', label: 'Renovación', hint: 'Recordatorio de vencimiento con la fecha de cada cliente.' },
  { id: 'campaign', label: 'Campaña', hint: 'Mensaje libre (tú escribes asunto y cuerpo).' },
  { id: 'maintenance', label: 'Mantenimiento', hint: 'Aviso de ventana de downtime programada.' },
]

export function Announcements() {
  const [appId, setAppId] = useState('flowfin')
  const [type, setType] = useState('renewal_fyi')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [maint, setMaint] = useState({ date: '', time: '', duration: '' })
  const [contacts, setContacts] = useState(null) // null | [{id,name,email}]
  const [sel, setSel] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  const appName = MSG_APPS.find((a) => a.id === appId)?.name ?? appId

  async function loadContacts() {
    setLoading(true); setFlash(null); setContacts(null); setSel(new Set())
    try {
      const out = await listContacts(appId)
      setContacts(out.contacts)
      setSel(new Set(out.contacts.map((c) => c.id)))
      if (out.contacts.length === 0) setFlash({ ok: false, msg: `Sin destinatarios con correo en ${appName}.` })
    } catch (e) { setFlash({ ok: false, msg: e.message }) } finally { setLoading(false) }
  }

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selected = (contacts ?? []).filter((c) => sel.has(c.id))
  const canSend = selected.length > 0 && (type !== 'campaign' || (subject.trim() && body.trim()))

  async function send() {
    setBusy(true); setFlash(null)
    try {
      const out = await sendMessage({ appId, type, recipients: selected, subject, body, maint })
      setFlash({ ok: out.failed === 0, msg: `Enviados: ${out.sent}${out.failed ? ` · fallidos: ${out.failed}` : ''} (${appName}).` })
      setConfirm(false)
    } catch (e) { setFlash({ ok: false, msg: e.message }) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHeader title="Comunicados" subtitle="Mensajes a tus clientes — renovación, campañas y avisos de mantenimiento. Un solo canal, con confirmación." />

      {flash && <p className={`mb-4 text-sm ${flash.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>{flash.msg}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Compose */}
        <div className="rounded-xl border border-hair bg-paper-card p-5 space-y-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-ink-mute">App</label>
            <select value={appId} onChange={(e) => { setAppId(e.target.value); setContacts(null) }}
              className="mt-1 w-full rounded-lg border border-hair bg-paper-card px-3 py-2 text-sm">
              {MSG_APPS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-ink-mute">Tipo</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {TYPES.map((t) => (
                <button key={t.id} onClick={() => setType(t.id)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${type === t.id ? 'border-brand bg-brand/10 text-brand' : 'border-hair text-ink hover:bg-paper-subtle'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-faint">{TYPES.find((t) => t.id === type)?.hint}</p>
          </div>

          {type === 'campaign' && (
            <>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto"
                className="w-full rounded-lg border border-hair bg-paper-card px-3 py-2 text-sm" />
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Cuerpo del mensaje… (un salto de línea doble = nuevo párrafo)"
                className="w-full rounded-lg border border-hair bg-paper-card px-3 py-2 text-sm" />
            </>
          )}
          {type === 'maintenance' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <input type="date" value={maint.date} onChange={(e) => setMaint({ ...maint, date: e.target.value })} className="rounded-lg border border-hair bg-paper-card px-2 py-2 text-sm" />
                <input type="time" value={maint.time} onChange={(e) => setMaint({ ...maint, time: e.target.value })} className="rounded-lg border border-hair bg-paper-card px-2 py-2 text-sm" />
                <input value={maint.duration} onChange={(e) => setMaint({ ...maint, duration: e.target.value })} placeholder="2 h" className="rounded-lg border border-hair bg-paper-card px-2 py-2 text-sm" />
              </div>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Detalle opcional del mantenimiento…"
                className="w-full rounded-lg border border-hair bg-paper-card px-3 py-2 text-sm" />
            </>
          )}
          {type === 'trial_offer' && (
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Detalle opcional (planes, precio, promoción)…"
              className="w-full rounded-lg border border-hair bg-paper-card px-3 py-2 text-sm" />
          )}
          {type === 'renewal' && (
            <p className="rounded-lg bg-paper-subtle px-3 py-2 text-sm text-ink-soft">
              Se envía el recordatorio de renovación con la <strong>fecha de vencimiento de cada cliente</strong> y la frase de valor de {appName}. Sin datos de uso.
            </p>
          )}
          {type === 'renewal_fyi' && (
            <p className="rounded-lg bg-paper-subtle px-3 py-2 text-sm text-ink-soft">
              Aviso <strong>personal y FYI</strong> para clientes con plan activo: el cobro en Mercado Pago corre <strong>solo el día 1</strong>. Incluye la fecha hasta la que queda cubierto. Sin datos de uso.
            </p>
          )}
        </div>

        {/* Recipients */}
        <div className="rounded-xl border border-hair bg-paper-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Destinatarios</h3>
            <button onClick={loadContacts} disabled={loading} className="rounded-lg border border-hair px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-subtle disabled:opacity-50">
              {loading ? 'Cargando…' : 'Cargar de ' + appName}
            </button>
          </div>
          {contacts === null ? (
            <p className="mt-4 text-sm text-ink-faint">Carga los contactos del app para elegir a quién enviar.</p>
          ) : contacts.length === 0 ? (
            <p className="mt-4 text-sm text-ink-faint">Sin destinatarios con correo.</p>
          ) : (
            <>
              <div className="mt-3 flex items-center justify-between text-xs text-ink-mute">
                <span><span className="font-display font-semibold text-ink">{selected.length}</span> de {contacts.length} seleccionados</span>
                <button onClick={() => setSel(sel.size === contacts.length ? new Set() : new Set(contacts.map((c) => c.id)))} className="text-brand hover:text-brand-deep">
                  {sel.size === contacts.length ? 'Quitar todos' : 'Seleccionar todos'}
                </button>
              </div>
              <div className="mt-2 max-h-72 overflow-y-auto divide-y divide-hair">
                {contacts.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 py-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} className="accent-brand" />
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{c.name ?? '(sin nombre)'}</span>
                      <span className="ml-2 text-ink-faint truncate">{c.email}</span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end gap-3">
        <span className="text-sm text-ink-mute">{selected.length} destinatario(s)</span>
        <button onClick={() => setConfirm(true)} disabled={!canSend}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-deep disabled:opacity-40">
          Revisar y enviar
        </button>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" onClick={() => !busy && setConfirm(false)}>
          <div className="w-full max-w-md rounded-2xl border border-hair bg-paper-card p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-semibold text-ink">Confirmar envío</h3>
            <p className="mt-2 text-sm text-ink-soft">
              Vas a enviar un correo <strong>real</strong> de tipo <strong>{TYPES.find((t) => t.id === type)?.label}</strong> a
              <strong className="text-ink"> {selected.length} cliente(s)</strong> de <strong>{appName}</strong>.
            </p>
            {type === 'campaign' && <p className="mt-2 rounded-lg bg-paper-subtle px-3 py-2 text-sm text-ink-soft"><strong>{subject}</strong></p>}
            <p className="mt-2 text-xs text-ink-faint">Esta acción envía correos a tus clientes y no se puede deshacer.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirm(false)} disabled={busy} className="rounded-lg border border-hair px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-subtle disabled:opacity-50">Cancelar</button>
              <button onClick={send} disabled={busy} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-deep disabled:opacity-50">{busy ? 'Enviando…' : `Enviar a ${selected.length}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
