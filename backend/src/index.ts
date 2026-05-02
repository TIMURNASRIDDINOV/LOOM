import { Hono } from 'hono'
import { cors } from 'hono/cors'
import publicRoutes from './routes/public'
import authRoutes from './routes/auth'
import adminRoutes, { setupRouter } from './routes/admin'
import adminProductsRoutes from './routes/admin-products'
import filesRoutes from './routes/files'
import type { BaseEnv } from './types'

const ALLOWED_ORIGINS = [
  'https://looom.me',
  'https://www.looom.me',
  'https://admin.looom.me',
  'http://localhost:8787',
  'http://localhost:3000',
  // Allow file:// and local admin panel during development
  'null',
]

const app = new Hono<BaseEnv>()

// ─── CORS ─────────────────────────────────────────────────────────────────────

app.use(
  '*',
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400,
  }),
)

// ─── Routes ───────────────────────────────────────────────────────────────────

app.route('/api', publicRoutes)           // GET /api/products, GET /api/products/:slug, POST /api/orders, POST /api/uploads, GET /api/me/orders
app.route('/api/auth', authRoutes)        // POST /api/auth/register, /login, GET /api/auth/me
app.route('/api/admin', adminRoutes)      // /api/admin/* (orders, auth, media)
app.route('/api/admin', setupRouter)      // POST /api/admin/setup (no auth required)
app.route('/api/admin', adminProductsRoutes)  // /api/admin/products/*, /api/admin/stats
app.route('/api/files', filesRoutes)      // GET /api/files/models/:key

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
