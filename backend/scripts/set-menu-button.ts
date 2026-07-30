#!/usr/bin/env npx tsx
/**
 * One-shot script: points the bot's menu button at the LOOM Mini App.
 *
 * After this, every chat with the bot shows a button next to the message
 * field that opens loomdesign.uz inside Telegram (iOS, Android, desktop,
 * web) with signed initData for zero-tap login (see assets/tma.js).
 *
 * Usage:
 *   BOT_TOKEN=<token> npx tsx scripts/set-menu-button.ts
 *
 * Optional:
 *   APP_URL=https://loomdesign.uz   (default)
 *   BUTTON_TEXT="LOOM"              (default; max 16 chars)
 */

const BOT_TOKEN = process.env.BOT_TOKEN
const APP_URL = process.env.APP_URL ?? 'https://loomdesign.uz'
const BUTTON_TEXT = process.env.BUTTON_TEXT ?? 'LOOM'

if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN env var is required')
  process.exit(1)
}

console.log(`Setting menu button → ${APP_URL} ("${BUTTON_TEXT}")`)

const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    menu_button: {
      type: 'web_app',
      text: BUTTON_TEXT,
      web_app: { url: APP_URL },
    },
  }),
})

const data = await res.json() as { ok: boolean; description?: string }
if (data.ok) {
  console.log('✅ Menu button set — open the bot chat to see it')
} else {
  console.error('❌ Failed to set menu button:', data.description)
  process.exit(1)
}
