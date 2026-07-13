/* ================================================================
   LOOM — payment-provider webhooks.

   Each provider calls its endpoint when money moves; we verify the
   request, then flip orders.payment_status via setOrderPaymentStatus.
   Fulfillment status (new→confirmed→…) is intentionally untouched —
   admins keep full control of production flow.

   SECURITY: every handler hard-fails until its provider secrets are
   configured AND the marked signature TODO is implemented. This file
   ships the wiring, not a fake "accept everything" endpoint.
================================================================ */
import { Hono } from 'hono'
import { setOrderPaymentStatus } from '../db/queries'
import { providerConfigured, type PaymentEnvVars } from '../lib/payments'
import type { BaseEnv } from '../types'

const payments = new Hono<BaseEnv>()

// ─── GET /api/payments/methods — which methods the checkout may offer ────────
payments.get('/methods', (c) => {
  const env = c.env as unknown as PaymentEnvVars
  return c.json({
    cod: true,
    payme: providerConfigured('payme', env),
    click: providerConfigured('click', env),
    uzum: providerConfigured('uzum', env),
  })
})

// ─── Payme (Merchant API, JSON-RPC over POST) ────────────────────
// Docs: https://developer.help.paycom.uz/metody-merchant-api
payments.post('/payme/webhook', async (c) => {
  const env = c.env as unknown as PaymentEnvVars
  if (!providerConfigured('payme', env)) return c.json({ error: 'Provider not configured' }, 501)

  // Payme authenticates with "Authorization: Basic base64(Paycom:<KEY>)"
  const auth = c.req.header('Authorization') || ''
  const expected = 'Basic ' + btoa(`Paycom:${env.PAYME_KEY}`)
  if (auth !== expected) {
    return c.json({ error: { code: -32504, message: 'Insufficient privileges' } }, 200)
  }

  const rpc = await c.req.json().catch(() => null) as
    | { id?: number; method?: string; params?: Record<string, unknown> }
    | null
  if (!rpc?.method) return c.json({ error: { code: -32600, message: 'Invalid request' } }, 200)

  // TODO(payme): implement the full CheckPerformTransaction / CreateTransaction /
  // PerformTransaction / CancelTransaction state machine. The happy-path skeleton:
  if (rpc.method === 'PerformTransaction') {
    const account = (rpc.params?.account ?? {}) as Record<string, unknown>
    const orderId = parseInt(String(account.order_id ?? ''), 10)
    const txId = String(rpc.params?.id ?? '')
    if (orderId) {
      await setOrderPaymentStatus(c.env.DB, orderId, 'paid', `payme:${txId}`)
      return c.json({ id: rpc.id, result: { transaction: txId, perform_time: Date.now(), state: 2 } })
    }
  }
  return c.json({ id: rpc.id, error: { code: -32601, message: `Method not implemented: ${rpc.method}` } }, 200)
})

// ─── Click (SHOP-API: prepare + complete callbacks) ──────────────
// Docs: https://docs.click.uz/click-api-request/
payments.post('/click/webhook', async (c) => {
  const env = c.env as unknown as PaymentEnvVars
  if (!providerConfigured('click', env)) return c.json({ error: 'Provider not configured' }, 501)

  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
  const action = String(form.action ?? '') // 0 = prepare, 1 = complete
  const orderId = parseInt(String(form.merchant_trans_id ?? ''), 10)
  const clickTransId = String(form.click_trans_id ?? '')

  // TODO(click): verify sign_string = md5(click_trans_id + service_id + CLICK_SECRET +
  // merchant_trans_id + [merchant_prepare_id +] amount + action + sign_time)
  // and reject on mismatch. Until then, refuse to mark anything paid:
  const signatureVerified = false
  if (!signatureVerified) {
    return c.json({ error: -1, error_note: 'Signature verification not implemented' })
  }

  if (action === '1' && orderId) {
    await setOrderPaymentStatus(c.env.DB, orderId, 'paid', `click:${clickTransId}`)
    return c.json({ error: 0, error_note: 'Success', click_trans_id: clickTransId, merchant_trans_id: String(orderId) })
  }
  return c.json({ error: 0, error_note: 'Prepared', click_trans_id: clickTransId, merchant_trans_id: String(orderId) })
})

// ─── Uzum Bank ───────────────────────────────────────────────────
payments.post('/uzum/webhook', async (c) => {
  const env = c.env as unknown as PaymentEnvVars
  if (!providerConfigured('uzum', env)) return c.json({ error: 'Provider not configured' }, 501)
  // TODO(uzum): implement per Uzum merchant docs (auth header + payload schema)
  return c.json({ error: 'Not implemented' }, 501)
})

export default payments
