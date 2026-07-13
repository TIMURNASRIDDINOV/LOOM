import { Hono } from 'hono'
import { cors } from 'hono/cors'
import publicRoutes from './routes/public'
import authRoutes from './routes/auth'
import telegramAuthRoutes, { webhookRouter } from './routes/telegram-auth'
import adminRoutes, { setupRouter } from './routes/admin'
import adminProductsRoutes from './routes/admin-products'
import adminUsersRoutes from './routes/admin-users'
import cartRoutes from './routes/cart'
import paymentsRoutes from './routes/payments'
import filesRoutes from './routes/files'
import userProfile from './routes/user-profile'
import type { BaseEnv } from './types'

const PROD_ORIGINS = [
  'https://loomdesign.uz',
  'https://www.loomdesign.uz',
  'https://admin.loomdesign.uz',
]

const DEV_ORIGINS = [
  'http://localhost:8787',
  'http://localhost:3000',
]

const app = new Hono<BaseEnv>()

// ─── CORS ─────────────────────────────────────────────────────────────────────

app.use('*', (c, next) => {
  const allowed =
    c.env.ENVIRONMENT === 'production' ? PROD_ORIGINS : [...PROD_ORIGINS, ...DEV_ORIGINS]
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : PROD_ORIGINS[0]),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400,
  })(c, next)
})

// ─── Routes ───────────────────────────────────────────────────────────────────

app.route('/api/cart', cartRoutes)            // GET/POST/PATCH/DELETE /api/cart, POST /api/cart/checkout
app.route('/api/payments', paymentsRoutes)    // POST /api/payments/{payme,click,uzum}/webhook
app.route('/api', publicRoutes)               // GET /api/products, POST /api/orders, etc.
app.route('/api/auth', authRoutes)            // POST /api/auth/register, /login, GET /api/auth/me, PATCH /profile etc.
app.route('/api/admin', adminRoutes)          // /api/admin/* (orders, auth, media, analytics)
app.route('/api/admin', setupRouter)          // POST /api/admin/setup (no auth required)
app.route('/api/admin', adminProductsRoutes)  // /api/admin/products/*, /api/admin/stats
app.route('/api/admin', adminUsersRoutes)     // /api/admin/users/*, /api/admin/notifications
app.route('/api/files', filesRoutes)          // GET /api/files/models/:key, POST /api/files/track
app.route('/api/auth', userProfile)
app.route('/api/auth', telegramAuthRoutes)     // POST /api/auth/telegram/{start,status}, /api/auth/logout
app.route('/api/telegram', webhookRouter)      // POST /api/telegram/webhook

// ─── Admin subdomain redirect ─────────────────────────────────────────────────

app.all('*', (c, next) => {
  const host = new URL(c.req.url).hostname
  if (host === 'admin.loomdesign.uz') {
    const url = new URL(c.req.url)
    const path = url.pathname === '/' ? '/admin/' : `/admin${url.pathname}`
    return c.redirect(`https://loomdesign.uz${path}${url.search}`, 301)
  }
  return next()
})

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (c) =>
  c.json({ service: 'LOOM Backend', version: '0.3.0', status: 'ok' }),
)

// ─── 404 / Error ──────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error('Unhandled error:', err.message, err.stack)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
