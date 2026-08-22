// Control action (WRITE, solo bodega): archiva, restaura o borra el RENGLÓN de
// una licencia en Mission Control — sin tocar la app.
//
// Está separado de `license-action` a propósito: aquel escribe la app (es lo que
// de verdad cambia el acceso del tenant) y este solo cambia qué ve el operador
// en el panel. Cuando se dan de baja los dos a la vez, quien lo hace es
// `license-action` con op:'cancel', que archiva después de escribir la app.
//
// Ops:
//   archive — saca el renglón del panel sin tocar la app. Para registros de
//             prueba o tenants que ya no existen del otro lado (donde el puente
//             fallaría), no para cortarle el acceso a alguien: eso es 'cancel'.
//   restore — lo devuelve al panel. Reversible siempre.
//   purge   — borra el renglón. Solo owner. Si el registro sigue vivo en la app,
//             el próximo sync lo vuelve a traer: eso es correcto (la app es la
//             fuente de verdad) y el endpoint lo dice en la respuesta.
import { supabaseAdmin, requireSupabase, audit } from '../supabaseAdmin.js'
import { requireMember } from '../requireMember.js'

const OPS = new Set(['archive', 'restore', 'purge'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return

  const { appId, licenseExternalId, op, reason } = req.body ?? {}
  if (!appId || !licenseExternalId || !op) return res.status(400).json({ error: 'falta appId/licenseExternalId/op' })
  if (!OPS.has(op)) return res.status(400).json({ error: `op desconocida: ${op}` })

  // Borrar el registro es lo único irreversible de aquí: pide owner, igual que
  // el borrado de datos Premium.
  const member = await requireMember(req, res, op === 'purge' ? 'owner' : 'admin')
  if (!member) return

  const where = (q) => q.eq('app_id', appId).eq('external_id', licenseExternalId)

  let result
  if (op === 'purge') {
    const { error } = await where(supabaseAdmin.from('licenses').delete())
    if (error) return res.status(500).json({ error: error.message })
    result = { purged: true }
  } else {
    const patch = op === 'archive'
      ? { archived_at: new Date().toISOString(), archived_by: member.email ?? null, archive_reason: reason ? String(reason).slice(0, 500) : null }
      : { archived_at: null, archived_by: null, archive_reason: null }
    const { data, error } = await where(supabaseAdmin.from('licenses').update(patch)).select('id')
    if (error) return res.status(500).json({ error: error.message })
    if (!data?.length) return res.status(404).json({ error: 'licencia no encontrada en la bodega' })
    result = { archived: op === 'archive' }
  }

  await audit('control:license-record', {
    actor: member.user_id, actor_email: member.email, target_app: appId, target_id: licenseExternalId,
    payload: { op, reason: reason ?? null },
  })
  return res.status(200).json({ ok: true, op, ...result })
}
