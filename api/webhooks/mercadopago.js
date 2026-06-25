// Mercado Pago payment webhook → revenue_events. Verifies the signature, fetches
// the full payment from MP, and upserts a normalized event (idempotent on
// provider+external_id). Responds 200 fast so MP doesn't retry needlessly.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { verifyWebhookSignature, fetchPayment, mapPaymentToEvent } from '../_lib/mercadopago.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return

  const body = req.body || {}
  const type = body.type || body.topic || body.action
  const dataId = body?.data?.id || req.query?.id || req.query?.['data.id']

  // Only payment notifications carry revenue; ack everything else.
  if (!String(type || '').includes('payment') || !dataId) {
    return res.status(200).json({ ignored: true, type: type ?? null })
  }

  // Verify signature when a secret is configured.
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  if (secret) {
    const ok = verifyWebhookSignature({
      signatureHeader: req.headers['x-signature'],
      requestId: req.headers['x-request-id'],
      dataId,
      secret,
    })
    if (!ok) return res.status(401).json({ error: 'invalid signature' })
  }

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!accessToken) return res.status(500).json({ error: 'MERCADOPAGO_ACCESS_TOKEN not set' })

  try {
    const payment = await fetchPayment(dataId, accessToken)
    const event = mapPaymentToEvent(payment)

    // Resolve tenant_id from (app_id, tenant_external_id) if present.
    let tenant_id = null
    if (event.app_id && event.tenant_external_id) {
      const { data: t } = await supabaseAdmin.from('tenants')
        .select('id').eq('app_id', event.app_id).eq('external_id', event.tenant_external_id).maybeSingle()
      tenant_id = t?.id ?? null
    }

    const { tenant_external_id: _drop, ...row } = event // exclude helper-only field
    const { error } = await supabaseAdmin.from('revenue_events')
      .upsert({ ...row, tenant_id }, { onConflict: 'provider,external_id' })
    if (error) throw new Error(error.message)

    await audit('mercadopago.payment', { target_app: event.app_id, target_id: event.external_id, payload: { status: payment.status, amount_cents: event.amount_cents } })
    return res.status(200).json({ ok: true, external_id: event.external_id })
  } catch (e) {
    console.error('[mercadopago]', e.message)
    return res.status(200).json({ ok: false, error: e.message }) // 200 so MP doesn't hammer retries on our errors
  }
}
