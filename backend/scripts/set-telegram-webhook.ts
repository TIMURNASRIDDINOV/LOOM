#!/usr/bin/env npx tsx
/**
 * One-shot script: registers our Worker URL as the Telegram bot webhook.
 *
 * Usage:
 *   BOT_TOKEN=<token> WORKER_URL=https://api.loomdesign.uz WEBHOOK_SECRET=<secret> npx tsx scripts/set-telegram-webhook.ts
 *
 * Or set them in a local .env (never commit it):
 *   BOT_TOKEN=...
 *   WORKER_URL=https://api.loomdesign.uz
 *   WEBHOOK_SECRET=...   (must match TELEGRAM_WEBHOOK_SECRET secret in wrangler)
 */

const BOT_TOKEN = process.env.BOT_TOKEN
const WORKER_URL = process.env.WORKER_URL ?? 'https://api.loomdesign.uz'
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET

if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN env var is required')
  process.exit(1)
}
if (!WEBHOOK_SECRET) {
  console.error('ERROR: WEBHOOK_SECRET env var is required (must match TELEGRAM_WEBHOOK_SECRET in wrangler)')
  process.exit(1)
}

const webhookUrl = `${WORKER_URL}/api/telegram/webhook`

console.log(`Registering webhook: ${webhookUrl}`)

const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  }),
})

const data = await res.json() as { ok: boolean; description?: string; result?: unknown }
if (data.ok) {
  console.log('✅ Webhook registered successfully')
  console.log('Result:', data.result)
} else {
  console.error('❌ Failed to register webhook:', data.description)
  process.exit(1)
}

// Verify webhook info
const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`)
const info = await infoRes.json() as { ok: boolean; result?: { url: string; has_custom_certificate: boolean; pending_update_count: number } }
if (info.ok && info.result) {
  console.log('\nWebhook info:')
  console.log('  URL:', info.result.url)
  console.log('  Pending updates:', info.result.pending_update_count)
}
