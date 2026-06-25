// Mercado Pago webhook helpers (pure where possible, for testability).
// Stripe is NOT used anywhere — payments are Mercado Pago only.
import crypto from 'node:crypto'

// Parse the `x-signature` header: "ts=1700000000,v1=<hex hmac>".
export function parseSignatureHeader(header) {
  const out = {}
  for (const part of String(header || '').split(',')) {
    const [k, v] = part.split('=')
    if (k && v) out[k.trim()] = v.trim()
  }
  return out // { ts, v1 }
}

// Manifest Mercado Pago signs (data.id lowercased when alphanumeric).
export function buildSignedManifest({ dataId, requestId, ts }) {
  const id = /^[a-z0-9]+$/i.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId)
  return `id:${id};request-id:${requestId};ts:${ts};`
}

// Verify the webhook signature against MERCADOPAGO_WEBHOOK_SECRET.
export function verifyWebhookSignature({ signatureHeader, requestId, dataId, secret }) {
  if (!secret) return false
  const { ts, v1 } = parseSignatureHeader(signatureHeader)
  if (!ts || !v1) return false
  const manifest = buildSignedManifest({ dataId, requestId, ts })
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex')
  // constant-time compare
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(v1, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

const STATUS_EVENT = {
  approved: 'payment',
  refunded: 'refund',
  charged_back: 'chargeback',
  cancelled: 'cancellation',
}

// Optionally pull app/tenant from external_reference "app:<id>;tenant:<id>".
function parseRef(ref) {
  const out = { app_id: null, tenant_external_id: null }
  for (const part of String(ref || '').split(/[;,|]/)) {
    const [k, v] = part.split(':')
    if (k === 'app' && v) out.app_id = v.trim()
    if (k === 'tenant' && v) out.tenant_external_id = v.trim()
  }
  return out
}

// Map a Mercado Pago payment object → a revenue_events row (sans tenant_id,
// which the handler resolves from tenant_external_id).
export function mapPaymentToEvent(payment) {
  const amount = Number(payment?.transaction_amount ?? 0)
  const { app_id, tenant_external_id } = parseRef(payment?.external_reference)
  return {
    provider: 'mercadopago',
    event_type: STATUS_EVENT[payment?.status] ?? 'payment',
    amount_cents: Math.round(Math.abs(amount) * 100),
    currency: payment?.currency_id || 'MXN',
    external_id: String(payment?.id ?? ''),
    occurred_at: payment?.date_approved || payment?.date_created || new Date().toISOString(),
    app_id,
    tenant_external_id,
    raw: payment ?? {},
  }
}

// Fetch full payment detail from the MP API (webhook only carries the id).
export async function fetchPayment(paymentId, accessToken) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`mercadopago payment ${paymentId} → ${res.status}`)
  return res.json()
}
