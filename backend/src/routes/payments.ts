/* ================================================================
   LOOM — payment-provider webhooks.

   Each provider calls its endpoint when money moves; we verify the
   request, then flip orders.payment_status via setOrderPaymentStatus.
   Fulfillment status (new→confirmed→…) is intentionally untouched —
   admins keep full control of production flow.

   SECURITY: every handler hard-fails until its provider is enabled
   (secrets set; for Payme also PAYME_LIVE=true). Click and Uzum also
   refuse until their marked signature TODO is implemented.
================================================================ */
import { Hono } from 'hono'
import { getOrderById, setOrderPaymentStatus } from '../db/queries'
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
//
// Closed (501) unless PAYME_LIVE=true and the secrets are set. Every
// transaction is recorded in payme_transactions and changes state at most
// once: 1 created → 2 performed, or 1 → -1 cancelled. The amount must equal
// the order total in tiyin when the transaction is checked and created.

const PAYME_TIMEOUT_MS = 12 * 60 * 60 * 1000 // Payme's create→perform limit

type PaymeTx = {
  id: string
  order_id: number
  amount: number
  state: number
  payme_time: number
  create_time: number
  perform_time: number
  cancel_time: number
  reason: number | null
}

class PaymeError extends Error {
  constructor(public code: number, message: string, public data?: string) {
    super(message)
  }
}

const paymeMsg = (ru: string, en: string) => ({ ru, uz: ru, en })

/** Comparison whose time does not depend on where the strings differ. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** The order a Payme call refers to, if it may be paid for `params.amount` tiyin. */
async function payableOrder(db: D1Database, params: Record<string, unknown>) {
  const account = (params.account ?? {}) as Record<string, unknown>
  const orderId = parseInt(String(account.order_id ?? ''), 10)
  const order = orderId ? await getOrderById(db, orderId) : null
  if (!order) throw new PaymeError(-31050, 'Order not found', 'order_id')
  const o = order as typeof order & { payment_method?: string; payment_status?: string }
  if (
    o.payment_method !== 'payme' ||
    o.status === 'cancelled' ||
    (o.payment_status !== 'unpaid' && o.payment_status !== 'pending')
  ) {
    throw new PaymeError(-31051, 'Order cannot be paid', 'order_id')
  }
  const amount = params.amount
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount !== Math.round(order.total_price * 100)) {
    throw new PaymeError(-31001, 'Wrong amount')
  }
  return { order, amount }
}

async function getTx(db: D1Database, id: string): Promise<PaymeTx | null> {
  return db.prepare('SELECT * FROM payme_transactions WHERE id = ?').bind(id).first<PaymeTx>()
}

/** Cancel a created transaction (state 1 → -1). No-op unless it is in state 1. */
async function cancelCreated(db: D1Database, tx: PaymeTx, reason: number): Promise<void> {
  const now = Date.now()
  const r = await db
    .prepare('UPDATE payme_transactions SET state = -1, cancel_time = ?, reason = ? WHERE id = ? AND state = 1')
    .bind(now, reason, tx.id)
    .run()
  if (!r.meta.changes) return
  await db
    .prepare("UPDATE orders SET payment_status = 'unpaid', updated_at = ? WHERE id = ? AND payment_status = 'pending'")
    .bind(now, tx.order_id)
    .run()
}

async function paymeRpc(db: D1Database, method: string, params: Record<string, unknown>): Promise<unknown> {
  const txId = typeof params.id === 'string' ? params.id : ''

  switch (method) {
    case 'CheckPerformTransaction': {
      await payableOrder(db, params)
      return { allow: true }
    }

    case 'CreateTransaction': {
      if (!txId) throw new PaymeError(-31003, 'Transaction not found')
      const existing = await getTx(db, txId)
      if (existing) {
        if (existing.state !== 1) throw new PaymeError(-31008, 'Transaction is not active')
        if (Date.now() - existing.create_time > PAYME_TIMEOUT_MS) {
          await cancelCreated(db, existing, 4)
          throw new PaymeError(-31008, 'Transaction timed out')
        }
        return { create_time: existing.create_time, transaction: existing.id, state: 1 }
      }
      const { order, amount } = await payableOrder(db, params)
      // One live transaction per order.
      const other = await db
        .prepare('SELECT 1 AS x FROM payme_transactions WHERE order_id = ? AND state IN (1, 2) LIMIT 1')
        .bind(order.id)
        .first()
      if (other) throw new PaymeError(-31052, 'Order already has a transaction', 'order_id')

      const now = Date.now()
      const paymeTime = typeof params.time === 'number' ? params.time : now
      await db
        .prepare(
          `INSERT INTO payme_transactions (id, order_id, amount, state, payme_time, create_time)
           VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .bind(txId, order.id, amount, paymeTime, now)
        .run()
      await setOrderPaymentStatus(db, order.id, 'pending', `payme:${txId}`)
      return { create_time: now, transaction: txId, state: 1 }
    }

    case 'PerformTransaction': {
      const tx = txId ? await getTx(db, txId) : null
      if (!tx) throw new PaymeError(-31003, 'Transaction not found')
      if (tx.state === 2) return { transaction: tx.id, perform_time: tx.perform_time, state: 2 }
      if (tx.state !== 1) throw new PaymeError(-31008, 'Transaction is not active')
      if (Date.now() - tx.create_time > PAYME_TIMEOUT_MS) {
        await cancelCreated(db, tx, 4)
        throw new PaymeError(-31008, 'Transaction timed out')
      }
      const now = Date.now()
      // Conditional update: a concurrent or repeated perform changes nothing.
      const r = await db
        .prepare('UPDATE payme_transactions SET state = 2, perform_time = ? WHERE id = ? AND state = 1')
        .bind(now, tx.id)
        .run()
      if (r.meta.changes) {
        await setOrderPaymentStatus(db, tx.order_id, 'paid', `payme:${tx.id}`)
        return { transaction: tx.id, perform_time: now, state: 2 }
      }
      const cur = await getTx(db, tx.id)
      if (cur?.state === 2) return { transaction: cur.id, perform_time: cur.perform_time, state: 2 }
      throw new PaymeError(-31008, 'Transaction is not active')
    }

    case 'CancelTransaction': {
      const tx = txId ? await getTx(db, txId) : null
      if (!tx) throw new PaymeError(-31003, 'Transaction not found')
      if (tx.state === 1) await cancelCreated(db, tx, typeof params.reason === 'number' ? params.reason : 0)
      const cur = (await getTx(db, tx.id))!
      // Refunds after payment are handled by the shop, not through Payme.
      if (cur.state === 2) throw new PaymeError(-31007, 'Order already paid; cannot cancel')
      return { transaction: cur.id, cancel_time: cur.cancel_time, state: cur.state }
    }

    case 'CheckTransaction': {
      const tx = txId ? await getTx(db, txId) : null
      if (!tx) throw new PaymeError(-31003, 'Transaction not found')
      return {
        create_time: tx.create_time,
        perform_time: tx.perform_time,
        cancel_time: tx.cancel_time,
        transaction: tx.id,
        state: tx.state,
        reason: tx.reason,
      }
    }

    case 'GetStatement': {
      const from = typeof params.from === 'number' ? params.from : 0
      const to = typeof params.to === 'number' ? params.to : 0
      const { results } = await db
        .prepare('SELECT * FROM payme_transactions WHERE payme_time BETWEEN ? AND ? ORDER BY payme_time')
        .bind(from, to)
        .all<PaymeTx>()
      return {
        transactions: results.map((t) => ({
          id: t.id,
          time: t.payme_time,
          amount: t.amount,
          account: { order_id: String(t.order_id) },
          create_time: t.create_time,
          perform_time: t.perform_time,
          cancel_time: t.cancel_time,
          transaction: t.id,
          state: t.state,
          reason: t.reason,
        })),
      }
    }

    default:
      throw new PaymeError(-32601, 'Method not found')
  }
}

payments.post('/payme/webhook', async (c) => {
  const env = c.env as unknown as PaymentEnvVars
  if (!providerConfigured('payme', env)) return c.json({ error: 'Provider not configured' }, 501)

  const rpc = (await c.req.json().catch(() => null)) as
    | { id?: number; method?: string; params?: Record<string, unknown> }
    | null
  const id = rpc?.id ?? null

  // Payme authenticates with "Authorization: Basic base64(Paycom:<KEY>)"
  const expected = 'Basic ' + btoa(`Paycom:${env.PAYME_KEY}`)
  if (!safeEqual(c.req.header('Authorization') || '', expected)) {
    return c.json({ id, error: { code: -32504, message: paymeMsg('Недостаточно привилегий', 'Insufficient privileges') } })
  }
  if (!rpc?.method) {
    return c.json({ id, error: { code: -32600, message: paymeMsg('Неверный запрос', 'Invalid request') } })
  }

  try {
    return c.json({ id, result: await paymeRpc(c.env.DB, rpc.method, rpc.params ?? {}) })
  } catch (e) {
    if (e instanceof PaymeError) {
      return c.json({ id, error: { code: e.code, message: paymeMsg(e.message, e.message), data: e.data } })
    }
    console.error('[payme] handler failed:', e)
    return c.json({ id, error: { code: -32400, message: paymeMsg('Системная ошибка', 'System error') } })
  }
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
