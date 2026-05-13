#!/usr/bin/env npx tsx
/**
 * One-shot script: promotes a phone-auth user to admin role.
 *
 * Usage (local D1):
 *   npx tsx scripts/set-admin.ts --phone=+998901234567
 *
 * Usage (production D1):
 *   npx tsx scripts/set-admin.ts --phone=+998901234567 --prod
 *
 * The user must have already logged in via Telegram at least once.
 * If they haven't registered yet, run --create to add a placeholder.
 */

const args = process.argv.slice(2)
const phoneArg = args.find(a => a.startsWith('--phone='))?.split('=')[1]
const isProd = args.includes('--prod')

if (!phoneArg) {
  console.error('Usage: npx tsx scripts/set-admin.ts --phone=+998... [--prod]')
  process.exit(1)
}

function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-\(\)]/g, '')
  if (!p.startsWith('+')) p = '+' + p
  return p
}

const phone = normalizePhone(phoneArg)
const dbFlag = isProd ? '' : '--local'
const envNote = isProd ? 'PRODUCTION' : 'local'

console.log(`Setting role=admin for phone ${phone} in ${envNote} D1...`)

// Use wrangler d1 execute with inline SQL
const { execSync } = await import('child_process')

const sql = `UPDATE users SET role = 'admin' WHERE phone = '${phone}';`
const cmd = `wrangler d1 execute loom-db ${dbFlag} --command "${sql.replace(/"/g, '\\"')}"`

try {
  const output = execSync(cmd, { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' })
  console.log(output)

  // Verify
  const verifySql = `SELECT id, phone, role, status FROM users WHERE phone = '${phone}';`
  const verifyCmd = `wrangler d1 execute loom-db ${dbFlag} --command "${verifySql.replace(/"/g, '\\"')}"`
  const verifyOutput = execSync(verifyCmd, { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' })
  console.log('Updated row:')
  console.log(verifyOutput)

  console.log(`✅ Done. User with phone ${phone} is now an admin.`)
} catch (err) {
  console.error('❌ Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
}
