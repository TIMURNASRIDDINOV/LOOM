// Telegram notification for new orders

interface OrderNotificationData {
  id: number
  customerName: string
  customerPhone: string
  address: string | null
  coordinates: string | null
  comment: string | null
  totalPrice: number
  designJson: string
  productName: string | null
  size?: string
}

function formatPrice(sums: number): string {
  return new Intl.NumberFormat('ru-RU').format(sums) + ' сум'
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })
}

function escapeHtml(text: string | null | undefined): string {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .substring(0, 400)
}

function parseDesign(json: string): { color?: string; frontText?: string; backText?: string; size?: string } {
  try {
    const d = JSON.parse(json) as Record<string, unknown>
    return {
      color: typeof d.shirtColor === 'string' ? d.shirtColor : undefined,
      frontText:
        typeof d.front === 'object' && d.front !== null
          ? (d.front as Record<string, unknown>).text !== null &&
            typeof (d.front as Record<string, { content?: string }>).text?.content === 'string'
            ? (d.front as Record<string, { content: string }>).text.content
            : undefined
          : undefined,
      backText:
        typeof d.back === 'object' && d.back !== null
          ? typeof (d.back as Record<string, { content?: string }>).text?.content === 'string'
            ? (d.back as Record<string, { content: string }>).text.content
            : undefined
          : undefined,
      size: typeof d.size === 'string' ? d.size : undefined,
    }
  } catch {
    return {}
  }
}

export function buildOrderMessage(order: OrderNotificationData): string {
  const design = parseDesign(order.designJson)
  const size = order.size ?? design.size ?? '—'
  const frontText = design.frontText ? `"${escapeHtml(design.frontText)}"` : '(не указан)'
  const backText = design.backText ? `"${escapeHtml(design.backText)}"` : '(не указан)'

  const lines = [
    `🛍 <b>Новый заказ LOOM #${order.id}</b>`,
    '',
    `👕 Товар: ${escapeHtml(order.productName) || 'Футболка Oversized'}`,
    `🎨 Цвет: <code>${escapeHtml(design.color)}</code>`,
    `📏 Размер: ${escapeHtml(size)}`,
    `📝 Перед — текст: ${frontText}`,
    `📝 Зад — текст: ${backText}`,
    '',
    `👤 Клиент: <b>${escapeHtml(order.customerName)}</b>`,
    `📞 Телефон: <code>${escapeHtml(order.customerPhone)}</code>`,
    `📍 Адрес: ${escapeHtml(order.address) || 'не указан'}`,
  ]

  if (order.coordinates) lines.push(`🗺 Координаты: ${escapeHtml(order.coordinates)}`)
  if (order.comment) lines.push(`💬 Комментарий: ${escapeHtml(order.comment)}`)

  lines.push(`💰 Сумма: <b>${formatPrice(order.totalPrice)}</b>`)
  lines.push(`🕐 Время: ${formatDate(Date.now())}`)

  return lines.join('\n')
}

/**
 * Send one HTML message to a chat, optionally with a single URL button.
 * Never throws — callers decide whether a failed delivery matters.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  button?: { label: string; url: string },
): Promise<{ ok: boolean; messageId: number | null; error: string | null }> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }
  if (button) payload.reply_markup = { inline_keyboard: [[{ text: button.label, url: button.url }]] }
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = (await res.json().catch(() => null)) as
      | { ok: boolean; result?: { message_id: number }; description?: string }
      | null
    if (data?.ok) return { ok: true, messageId: data.result?.message_id ?? null, error: null }
    return { ok: false, messageId: null, error: data?.description ?? `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, messageId: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function sendOrderNotification(
  botToken: string,
  chatId: string,
  order: OrderNotificationData,
): Promise<void> {
  const text = buildOrderMessage(order)
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error(
      `[Telegram] Notification failed for order #${order.id} — HTTP ${res.status}:`,
      body,
    )
    // TODO: store in failed_notifications table for retry
  }
}
