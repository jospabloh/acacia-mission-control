// Review of a testimonial (contract §5): approve | reject | unpublish, admin+.
// The person's text is never edited here. The caller sends the `updatedAt` of
// the row it SAW; if the row changed since (a re-send, a withdrawal) the answer
// is 409 and nothing is written. Every decision goes through audit().
import { supabaseAdmin, requireSupabase, audit } from '../supabaseAdmin.js'
import { requireMember } from '../requireMember.js'
import { reviewDecision } from '../testimonials.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return

  const { id, op, updatedAt } = req.body ?? {}
  if (!id || !op) return res.status(400).json({ error: 'falta id/op' })
  const member = await requireMember(req, res, 'admin')
  if (!member) return

  const { data: row, error } = await supabaseAdmin
    .from('testimonials').select('id, app_id, external_id, status, updated_at').eq('id', id).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })

  const d = reviewDecision(row, { op, updatedAt })
  if (d.error) return res.status(d.code).json({ error: d.error })

  // Guarded on the exact version read (status + updated_at): a change landing
  // between the read and this write wins, and the reviewer gets a 409.
  const { data: updated, error: upErr } = await supabaseAdmin
    .from('testimonials')
    .update({ status: d.status, reviewed_by: member.email, reviewed_at: new Date().toISOString() })
    .eq('id', row.id).eq('status', row.status).eq('updated_at', row.updated_at).select('id, status').maybeSingle()
  if (upErr) return res.status(500).json({ error: upErr.message })
  if (!updated) return res.status(409).json({ error: 'el testimonio cambió mientras lo revisabas; recarga' })

  await audit('control:testimonial-review', {
    actor: member.user_id, actor_email: member.email, target_app: row.app_id, target_type: 'testimonial', target_id: row.external_id,
    payload: { op, from: row.status, to: d.status },
  })
  return res.status(200).json({ ok: true, id: row.id, status: d.status })
}
