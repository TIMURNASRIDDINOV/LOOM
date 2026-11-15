/* ================================================================
   LOOM — prepayment by card transfer (PRD-216).

   An order is born payment_method='p2p', payment_status='unpaid',
   status='new', pay_deadline = now + 30 min. From there:

     customer uploads a receipt and says "paid"  → payment_status 'pending'
     staff confirm                               → 'paid', status 'confirmed'
     staff reject                                → 'failed', a fresh 30 min
     deadline passes while unpaid / failed       → status 'cancelled',
                                                   log note 'payment_timeout'
     late receipt on a timed-out order           → back to 'new' + 'pending'

   Every transition is one conditional UPDATE, so a repeated or
   concurrent request changes nothing the second time.
================================================================ */
import { finishScheduledDeletions, getUserById, insertNotification } from '../db/queries'
import { sendTelegramMessage } from './telegram'
import type { Bindings } from '../types'

const SITE = 'https://loomdesign.uz'
/** The customer's order page; while unpaid it is the payment screen. */
export const orderUrl = (id: number) => `${SITE}/order?id=${id}`
export const adminOrderUrl = (id: number) => `${SITE}/admin/order.html?id=${id}`

export const TIMEOUT_NOTE = 'payment_timeout'
export const REMIND_BEFORE_MS = 5 * 60 * 1000
export const REJECT_REASONS = ['not_found', 'amount_mismatch'] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

/** SQL: this order was cancelled by the payment timeout and by nothing since. */
export const TIMED_OUT_SQL = `(orders.status = 'cancelled' AND
  (SELECT note FROM order_status_log WHERE order_id = orders.id ORDER BY id DESC LIMIT 1) = '${TIMEOUT_NOTE}')`

// No language is stored per user, so every message is Uzbek first, Russian second.
const REJECT_TEXT: Record<RejectReason, [string, string]> = {
  not_found: ["to'lov topilmadi", 'платёж не найден'],
  amount_mismatch: ['summa mos kelmadi', 'сумма не совпадает'],
}
export const PAY_MESSAGES = {
  reminder: (n: number) =>
    `⏳ LOOM #${n}: to'lovga 5 daqiqa qoldi. Kartaga o'tkazing va chekni yuboring.\n\n` +
    `⏳ LOOM #${n}: на оплату осталось 5 минут. Переведите на карту и отправьте чек.`,
  expired: (n: number) =>
    `⌛ LOOM #${n}: to'lov vaqti tugadi, buyurtma bekor qilindi. Pul o'tkazgan bo'lsangiz, chekni yuboring — buyurtma tiklanadi.\n\n` +
    `⌛ LOOM #${n}: время оплаты истекло, заказ отменён. Если вы уже перевели деньги, отправьте чек — заказ восстановится.`,
  confirmed: (n: number) =>
    `✅ LOOM #${n}: to'lov tasdiqlandi. Buyurtmani tayyorlashni boshlaymiz.\n\n` +
    `✅ LOOM #${n}: оплата подтверждена. Начинаем изготовление.`,
  rejected: (n: number, reason: RejectReason) =>
    `❌ LOOM #${n}: to'lov tasdiqlanmadi — ${REJECT_TEXT[reason][0]}. Chekni tekshirib, qayta yuboring.\n\n` +
    `❌ LOOM #${n}: оплата не подтверждена — ${REJECT_TEXT[reason][1]}. Проверьте чек и отправьте заново.`,
}
export const PAY_BUTTON = "To'lov · Оплата"
const RECEIPT_BUTTON = 'Chek yuborish · Отправить чек'

/** Telegram push (when linked) plus the in-site notification. Never throws. */
export async function notifyCustomer(
  env: Bindings,
  userId: number,
  text: string,
  button: { label: string; url: string } | null = null,
  adminId: number | null = null,
): Promise<void> {
  try {
    const user = await getUserById(env.DB, userId)
    const sent = user?.telegram_user_id && env.TELEGRAM_BOT_TOKEN
      ? await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, user.telegram_user_id, text, button ?? undefined)
      : null
    await insertNotification(env.DB, {
      user_id: userId,
      message: text,
      button_label: button?.label ?? null,
      button_url: button?.url ?? null,
      telegram_message_id: sent?.messageId ?? null,
      sent_by_admin_id: adminId,
      status: sent ? (sent.ok ? 'sent' : 'failed') : 'no_telegram',
      error_detail: sent?.error ?? null,
    })
  } catch (err) {
    console.error('[prepay] customer notification failed:', err)
  }
}

/** Tell the staff chat a receipt is waiting. Never throws. */
export async function notifyStaffReceipt(env: Bindings, order: { id: number; total_price: number }): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return
  const sum = new Intl.NumberFormat('ru-RU').format(order.total_price)
  const r = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID,
    `🧾 Чек загружен: заказ LOOM #${order.id}, ${sum} сум. Проверьте поступление и подтвердите оплату.`,
    { label: `Заказ #${order.id}`, url: adminOrderUrl(order.id) })
  if (!r.ok) console.error(`[prepay] staff message failed for order #${order.id}:`, r.error)
}

// ponytail: 20 orders per run keeps one invocation far below the Workers
// subrequest limit; the next minute takes the rest. Raise it if a single
// minute ever holds more than 20 expiring orders.
const BATCH = 20

/**
 * Cancel p2p orders whose payment window has passed. Called by the minute
 * sweep (no scope) and lazily before an order is read (one order / one user),
 * so a missed cron run never leaves an expired order looking payable.
 */
export async function expireOverdue(env: Bindings, scope: { orderId?: number; userId?: number } = {}): Promise<number> {
  const now = Date.now()
  const { results } = await env.DB.prepare(
    `SELECT id, user_id FROM orders
     WHERE payment_method = 'p2p' AND payment_status IN ('unpaid','failed') AND status = 'new'
       AND pay_deadline <= ?1 AND (?2 IS NULL OR id = ?2) AND (?3 IS NULL OR user_id = ?3)
     LIMIT ${BATCH}`,
  ).bind(now, scope.orderId ?? null, scope.userId ?? null).all<{ id: number; user_id: number | null }>()

  let cancelled = 0
  for (const o of results) {
    // The cancel and its log row commit together: the log note is what later
    // lets a late receipt revive exactly this kind of cancellation.
    const [update] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE orders SET status = 'cancelled', updated_at = ?1
         WHERE id = ?2 AND status = 'new' AND payment_method = 'p2p'
           AND payment_status IN ('unpaid','failed') AND pay_deadline <= ?1`,
      ).bind(now, o.id),
      env.DB.prepare(
        `INSERT INTO order_status_log (order_id, old_status, new_status, changed_by, changed_at, note)
         SELECT ?1, 'new', 'cancelled', NULL, ?2, '${TIMEOUT_NOTE}' WHERE changes() > 0`,
      ).bind(o.id, now),
    ])
    if (!update.meta.changes) continue
    cancelled++
    // A scheduled account deletion does not run here: the order holds it back
    // for LATE_RECEIPT_MS more (db/queries.ts), then the sweep below takes it.
    if (o.user_id) await notifyCustomer(env, o.user_id, PAY_MESSAGES.expired(o.id), { label: RECEIPT_BUTTON, url: orderUrl(o.id) })
  }
  return cancelled
}

/** One "5 minutes left" message per payment window. */
async function sendReminders(env: Bindings): Promise<void> {
  const now = Date.now()
  const { results } = await env.DB.prepare(
    `SELECT id, user_id FROM orders
     WHERE payment_method = 'p2p' AND payment_status IN ('unpaid','failed') AND status = 'new'
       AND pay_reminded_at IS NULL AND pay_deadline > ?1 AND pay_deadline <= ?2
     LIMIT ${BATCH}`,
  ).bind(now, now + REMIND_BEFORE_MS).all<{ id: number; user_id: number | null }>()
  for (const o of results) {
    const r = await env.DB.prepare('UPDATE orders SET pay_reminded_at = ? WHERE id = ? AND pay_reminded_at IS NULL')
      .bind(now, o.id).run()
    if (r.meta.changes && o.user_id) {
      await notifyCustomer(env, o.user_id, PAY_MESSAGES.reminder(o.id), { label: PAY_BUTTON, url: orderUrl(o.id) })
    }
  }
}

/** Receipt screenshots are kept this long, then deleted (founder decision 2026-11-15). */
export const RECEIPT_KEEP_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Delete receipt images past retention: 90 days after staff confirmed the
 * payment, or 90 days after upload on an order that was cancelled without a
 * confirmation. Deleted accounts only keep delivered / cancelled orders, so
 * their receipts are reached by the same rule. The order keeps its payment
 * status, amount, paid_at, pay_checked_* and receipt_at; receipt_key = NULL
 * with receipt_at set is what the admin page shows as "deleted after 90 days".
 * Safe to re-run: deleting a missing R2 object is a no-op, and the UPDATE
 * only clears the key it deleted.
 */
export async function purgeOldReceipts(env: Bindings): Promise<number> {
  const cutoff = Date.now() - RECEIPT_KEEP_MS
  // ponytail: no index on receipt_key, the orders table is scanned once a
  // minute. Add a partial index (WHERE receipt_key IS NOT NULL) if it grows big.
  const { results } = await env.DB.prepare(
    `SELECT id, receipt_key FROM orders
     WHERE receipt_key IS NOT NULL
       AND ((payment_status = 'paid' AND pay_checked_at <= ?1) OR (status = 'cancelled' AND receipt_at <= ?1))
     LIMIT ${BATCH}`,
  ).bind(cutoff).all<{ id: number; receipt_key: string }>()
  if (!results.length) return 0
  // Objects first: if this throws, the keys stay and the next minute retries.
  await env.LOOM_UPLOADS.delete(results.map((r) => r.receipt_key))
  await env.DB.batch(results.map((r) =>
    env.DB.prepare('UPDATE orders SET receipt_key = NULL WHERE id = ? AND receipt_key = ?').bind(r.id, r.receipt_key)))
  return results.length
}

/** The every-minute cron job (src/index.ts). */
export async function sweepPayments(env: Bindings): Promise<void> {
  // Each job runs even when the one before it failed.
  for (const job of [() => expireOverdue(env), () => sendReminders(env), () => finishScheduledDeletions(env.DB), () => purgeOldReceipts(env)]) {
    try { await job() } catch (err) { console.error('[prepay] sweep job failed:', err) }
  }
}
