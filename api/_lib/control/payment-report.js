// Control action (WRITE): registra que un tenant avisó que pagó — trazabilidad
// previa a la confirmación real (ver payment-confirm.js). No toca la licencia
// del app todavía. Gate: admin+ (cualquier operador puede registrar el aviso;
// solo owner confirma, ver payment-confirm.js).
import { supabaseAdmin, requireSupabase, audit } from '../supabaseAdmin.js'
import { requireMember } from '../requireMember.js'
import { licenseControlFor } from '../licenseControl.js'

export function assertReportPayload(body) {
  if (!body?.appId || !body?.licenseExternalId) return { ok: false, error: 'falta appId/licenseExternalId' }
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'amount debe ser un número mayor a 0' }
  return { ok: true }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'admin')
  if (!member) return

  const check = assertReportPayload(req.body)
  if (!check.ok) return res.status(400).json({ error: check.error })

  const { appId, licenseExternalId, amount, reference, note } = req.body
  if (!licenseControlFor(appId)) return res.status(400).json({ error: `app ${appId} no soporta control de licencia` })

  const { data, error } = await supabaseAdmin.from('payment_reports')
    .insert({ app_id: appId, external_id: licenseExternalId, amount: Number(amount), reference: reference || null, note: note || null, reported_by: member.email })
    .select('id').single()
  if (error) {
    // Unique-violation contra el índice parcial payment_reports_one_pending
    // (0031, `(app_id, external_id) where confirmed_at is null`) — ya existe
    // un reporte sin confirmar para este mismo tenant. Devolver 409 con un
    // mensaje claro en vez del 500 genérico, para que la UI no lo trate como
    // un error inesperado.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'ya existe un reporte de pago pendiente para este tenant' })
    }
    return res.status(500).json({ error: error.message })
  }

  await audit('control:payment-report', { actor: member.user_id, actor_email: member.email, target_app: appId, target_id: licenseExternalId, payload: { amount, reference: reference || null } })
  return res.status(200).json({ ok: true, id: data.id })
}
