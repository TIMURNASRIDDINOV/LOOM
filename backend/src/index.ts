import { Hono } from 'hono'
import { cors } from 'hono/cors'
import publicRoutes from './routes/public'
import authRoutes from './routes/auth'
import adminRoutes, { setupRouter } from './routes/admin'
import adminProductsRoutes from './routes/admin-products'
import filesRoutes from './routes/files'
import type { BaseEnv } from './types'

const PROD_ORIGINS = [
  'https://looom.me',
  'https://www.looom.me',
  'https://admin.looom.me',
]

const DEV_ORIGINS = [
  'http://localhost:8787',
  'http://localhost:3000',
]

const app = new Hono<BaseEnv>()

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Dev origins (localhost) are only included when ENVIRONMENT !== "production".
// The 'null' origin (file:// protocol) is intentionally excluded from all envs.

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

app.route('/api', publicRoutes)           // GET /api/products, GET /api/products/:slug, POST /api/orders, POST /api/uploads, GET /api/me/orders
app.route('/api/auth', authRoutes)        // POST /api/auth/register, /login, GET /api/auth/me
app.route('/api/admin', adminRoutes)      // /api/admin/* (orders, auth, media)
app.route('/api/admin', setupRouter)      // POST /api/admin/setup (no auth required)
app.route('/api/admin', adminProductsRoutes)  // /api/admin/products/*, /api/admin/stats
app.route('/api/files', filesRoutes)      // GET /api/files/models/:key

// ─── Admin subdomain redirect ─────────────────────────────────────────────────
// admin.looom.me/* → https://www.looom.me/admin/*

app.all('*', (c, next) => {
  const host = new URL(c.req.url).hostname
  if (host === 'admin.looom.me') {
    const url = new URL(c.req.url)
    const path = url.pathname === '/' ? '/admin/' : `/admin${url.pathname}`
    return c.redirect(`https://www.looom.me${path}${url.search}`, 301)
  }
  return next()
})

// ─── Health check ────────────────────────────────────────────────────────────

app.get('/', (c) =>
  c.json({ service: 'LOOM Backend', version: '0.2.0', status: 'ok' }),
)

// ─── 404 / Error ─────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error('Unhandled error:', err.message, err.stack)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
