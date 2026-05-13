// All D1 queries via prepared statements — no string concatenation

import type { Product, User, Admin, Order, OrderStatusLog, AuthSession, NotificationSent } from './schema'

// ─── safeQuery helper ─────────────────────────────────────────────────────────
// Wraps every D1 call so errors are logged with context before re-throwing.

async function safeQuery<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[DB Error] ${label}:`, msg)
    throw new Error(`Database error in ${label}`)
  }
}

// ─── Products ────────────────────────────────────────────────────────────────

export async function getActiveProducts(db: D1Database): Promise<Product[]> {
  return safeQuery('getActiveProducts', async () => {
    const { results } = await db
      .prepare('SELECT * FROM products WHERE active = 1 ORDER BY display_order ASC, id ASC')
      .all<Product>()
    return results
  })
}

export async function getProductById(db: D1Database, id: number): Promise<Product | null> {
  return safeQuery('getProductById', () =>
    db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<Product>(),
  )
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  return safeQuery('getUserByEmail', () =>
    db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>(),
  )
}

export async function getUserById(db: D1Database, id: number): Promise<User | null> {
  return safeQuery('getUserById', () =>
    db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>(),
  )
}

export async function createUser(
  db: D1Database,
  params: { email: string; password_hash: string; name: string | null; phone: string | null },
): Promise<number> {
  return safeQuery('createUser', async () => {
    const result = await db
      .prepare(
        'INSERT INTO users (email, password_hash, name, phone, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(params.email, params.password_hash, params.name, params.phone, Date.now())
      .run()
    return Number(result.meta.last_row_id)
  })
}

// ─── Admins ──────────────────────────────────────────────────────────────────

export async function getAdminByEmail(db: D1Database, email: string): Promise<Admin | null> {
  return safeQuery('getAdminByEmail', () =>
    db.prepare('SELECT * FROM admins WHERE email = ?').bind(email).first<Admin>(),
  )
}

export async function getAdminById(db: D1Database, id: number): Promise<Admin | null> {
  return safeQuery('getAdminById', () =>
    db.prepare('SELECT * FROM admins WHERE id = ?').bind(id).first<Admin>(),
  )
}

export async function countAdmins(db: D1Database): Promise<number> {
  return safeQuery('countAdmins', async () => {
    const row = await db.prepare('SELECT COUNT(*) as c FROM admins').first<{ c: number }>()
    return row?.c ?? 0
  })
}

export async function createAdmin(
  db: D1Database,
  params: { email: string; password_hash: string },
): Promise<number> {
  return safeQuery('createAdmin', async () => {
    const result = await db
      .prepare('INSERT INTO admins (email, password_hash, created_at) VALUES (?, ?, ?)')
      .bind(params.email, params.password_hash, Date.now())
      .run()
    return Number(result.meta.last_row_id)
  })
}

export async function updateAdminPassword(
  db: D1Database,
  email: string,
  passwordHash: string,
): Promise<void> {
  return safeQuery('updateAdminPassword', async () => {
    await db
      .prepare('UPDATE admins SET password_hash = ? WHERE email = ?')
      .bind(passwordHash, email)
      .run()
  })
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export async function createOrder(
  db: D1Database,
  params: {
    user_id: number | null
    product_id: number | null
    customer_name: string
    customer_phone: string
    address: string | null
    coordinates: string | null
    comment: string | null
    design_json: string
    logo_key: string | null
    total_price: number
  },
): Promise<number> {
  return safeQuery('createOrder', async () => {
    const now = Date.now()
    const result = await db
      .prepare(
        `INSERT INTO orders
           (user_id, product_id, customer_name, customer_phone, address, coordinates,
            comment, design_json, logo_key, total_price, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
      )
      .bind(
        params.user_id,
        params.product_id,
        params.customer_name,
        params.customer_phone,
        params.address,
        params.coordinates,
        params.comment,
        params.design_json,
        params.logo_key,
        params.total_price,
        now,
        now,
      )
      .run()
    return Number(result.meta.last_row_id)
  })
}

export async function getOrderById(db: D1Database, id: number): Promise<Order | null> {
  return safeQuery('getOrderById', () =>
    db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Order>(),
  )
}

export async function getOrdersByUserId(
  db: D1Database,
  userId: number,
  page = 1,
  limit = 20,
): Promise<{ orders: Order[]; total: number }> {
  return safeQuery('getOrdersByUserId', async () => {
    const offset = (page - 1) * limit
    const countRow = await db
      .prepare('SELECT COUNT(*) as c FROM orders WHERE user_id = ?')
      .bind(userId)
      .first<{ c: number }>()
    const total = countRow?.c ?? 0
    const { results } = await db
      .prepare(
        'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      )
      .bind(userId, limit, offset)
      .all<Order>()
    return { orders: results, total }
  })
}

export interface AdminOrderRow extends Order {
  product_name_ru: string | null
  product_slug: string | null
}

export interface AdminOrdersFilter {
  status?: string
  page: number
  limit: number
  q?: string
}

export async function getAdminOrders(
  db: D1Database,
  filter: AdminOrdersFilter,
): Promise<{ orders: AdminOrderRow[]; total: number }> {
  return safeQuery('getAdminOrders', async () => {
    const offset = (filter.page - 1) * filter.limit
    const conditions: string[] = []
    const params: (string | number | null)[] = []

    if (filter.status) {
      conditions.push('o.status = ?')
      params.push(filter.status)
    }
    if (filter.q) {
      conditions.push('(o.customer_name LIKE ? OR o.customer_phone LIKE ?)')
      params.push(`%${filter.q}%`, `%${filter.q}%`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const countRow = await db
      .prepare(`SELECT COUNT(*) as c FROM orders o ${where}`)
      .bind(...params)
      .first<{ c: number }>()

    const total = countRow?.c ?? 0

    const { results } = await db
      .prepare(
        `SELECT o.*, p.name_ru as product_name_ru, p.slug as product_slug
         FROM orders o
         LEFT JOIN products p ON o.product_id = p.id
         ${where}
         ORDER BY o.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(...params, filter.limit, offset)
      .all<AdminOrderRow>()

    return { orders: results, total }
  })
}

export async function getOrderStatusLog(
  db: D1Database,
  orderId: number,
): Promise<OrderStatusLog[]> {
  return safeQuery('getOrderStatusLog', async () => {
    const { results } = await db
      .prepare('SELECT * FROM order_status_log WHERE order_id = ? ORDER BY changed_at ASC')
      .bind(orderId)
      .all<OrderStatusLog>()
    return results
  })
}

export async function updateOrderStatus(
  db: D1Database,
  id: number,
  status: string,
): Promise<void> {
  return safeQuery('updateOrderStatus', async () => {
    await db
      .prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, Date.now(), id)
      .run()
  })
}

// ─── Products (admin) ─────────────────────────────────────────────────────────

export async function getProductBySlug(db: D1Database, slug: string): Promise<Product | null> {
  return safeQuery('getProductBySlug', () =>
    db.prepare('SELECT * FROM products WHERE slug = ?').bind(slug).first<Product>(),
  )
}

export interface AdminProductsFilter {
  active?: string
  q?: string
  page: number
  limit: number
}

export async function getAdminProducts(
  db: D1Database,
  filter: AdminProductsFilter,
): Promise<{ products: Product[]; total: number }> {
  return safeQuery('getAdminProducts', async () => {
    const conditions: string[] = []
    const params: (string | number | null)[] = []

    if (filter.active !== undefined && filter.active !== '') {
      conditions.push('active = ?')
      params.push(parseInt(filter.active, 10))
    }
    if (filter.q) {
      conditions.push('(name_ru LIKE ? OR slug LIKE ?)')
      params.push(`%${filter.q}%`, `%${filter.q}%`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const offset = (filter.page - 1) * filter.limit

    const countRow = await db
      .prepare(`SELECT COUNT(*) as c FROM products ${where}`)
      .bind(...params)
      .first<{ c: number }>()
    const total = countRow?.c ?? 0

    const { results } = await db
      .prepare(
        `SELECT * FROM products ${where} ORDER BY display_order ASC, id ASC LIMIT ? OFFSET ?`,
      )
      .bind(...params, filter.limit, offset)
      .all<Product>()

    return { products: results, total }
  })
}

const ALLOWED_PRODUCT_COLUMNS = new Set([
  'slug', 'name_ru', 'name_en', 'description_ru', 'price',
  'glb_key', 'thumbnail_key', 'base_colors', 'active', 'display_order',
])

export async function createProduct(
  db: D1Database,
  params: {
    slug: string
    name_ru: string
    name_en: string | null
    description_ru: string | null
    price: number
    glb_key: string | null
    thumbnail_key: string | null
    base_colors: string | null
    active: number
    display_order: number
  },
): Promise<number> {
  return safeQuery('createProduct', async () => {
    const now = Date.now()
    const result = await db
      .prepare(
        `INSERT INTO products
           (slug, name_ru, name_en, description_ru, price, glb_key, thumbnail_key,
            base_colors, active, display_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        params.slug, params.name_ru, params.name_en, params.description_ru,
        params.price, params.glb_key, params.thumbnail_key,
        params.base_colors, params.active, params.display_order,
        now, now,
      )
      .run()
    return Number(result.meta.last_row_id)
  })
}

export async function updateProduct(
  db: D1Database,
  id: number,
  params: Partial<{
    slug: string; name_ru: string; name_en: string | null; description_ru: string | null
    price: number; glb_key: string | null; thumbnail_key: string | null
    base_colors: string | null; active: number; display_order: number
  }>,
): Promise<void> {
  return safeQuery('updateProduct', async () => {
    const sets: string[] = []
    const vals: (string | number | null)[] = []
    for (const [k, v] of Object.entries(params)) {
      if (!ALLOWED_PRODUCT_COLUMNS.has(k)) continue
      sets.push(`${k} = ?`)
      vals.push(v as string | number | null)
    }
    if (!sets.length) return
    sets.push('updated_at = ?')
    vals.push(Date.now(), id)
    await db
      .prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...vals)
      .run()
  })
}

export async function softDeleteProduct(db: D1Database, id: number): Promise<void> {
  return safeQuery('softDeleteProduct', async () => {
    await db
      .prepare('UPDATE products SET active = 0, updated_at = ? WHERE id = ?')
      .bind(Date.now(), id)
      .run()
  })
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface AdminStats {
  ordersByStatus: Record<string, number>
  revenueLast30Days: number
  ordersLast7Days: number
  topProducts: Array<{ product_id: number; name_ru: string | null; count: number }>
  ordersPerDay: Array<{ day: string; count: number }>
  recentOrders: Array<{ id: number; customer_name: string; status: string; total_price: number; created_at: number }>
}

export async function getAdminStats(db: D1Database): Promise<AdminStats> {
  return safeQuery('getAdminStats', async () => {
    const now = Date.now()
    const day30ago = now - 30 * 24 * 60 * 60 * 1000
    const day7ago = now - 7 * 24 * 60 * 60 * 1000

    const [statusRows, revenueRow, ordersWeekRow, topRows, dailyRows, recentRows] =
      await Promise.all([
        db
          .prepare('SELECT status, COUNT(*) as count FROM orders GROUP BY status')
          .all<{ status: string; count: number }>(),
        db
          .prepare(
            "SELECT SUM(total_price) as total FROM orders WHERE status != 'cancelled' AND created_at >= ?",
          )
          .bind(day30ago)
          .first<{ total: number | null }>(),
        db
          .prepare('SELECT COUNT(*) as count FROM orders WHERE created_at >= ?')
          .bind(day7ago)
          .first<{ count: number }>(),
        db
          .prepare(
            `SELECT o.product_id, p.name_ru, COUNT(*) as count
             FROM orders o LEFT JOIN products p ON o.product_id = p.id
             WHERE o.product_id IS NOT NULL
             GROUP BY o.product_id ORDER BY count DESC LIMIT 3`,
          )
          .all<{ product_id: number; name_ru: string | null; count: number }>(),
        db
          .prepare(
            `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') as day,
                    COUNT(*) as count
             FROM orders WHERE created_at >= ?
             GROUP BY day ORDER BY day ASC`,
          )
          .bind(day30ago)
          .all<{ day: string; count: number }>(),
        db
          .prepare(
            `SELECT id, customer_name, status, total_price, created_at
             FROM orders ORDER BY created_at DESC LIMIT 5`,
          )
          .all<{ id: number; customer_name: string; status: string; total_price: number; created_at: number }>(),
      ])

    const ordersByStatus: Record<string, number> = {}
    for (const row of statusRows.results) ordersByStatus[row.status] = row.count

    return {
      ordersByStatus,
      revenueLast30Days: revenueRow?.total ?? 0,
      ordersLast7Days: ordersWeekRow?.count ?? 0,
      topProducts: topRows.results,
      ordersPerDay: dailyRows.results,
      recentOrders: recentRows.results,
    }
  })
}

// ─── Phone/Telegram Auth ──────────────────────────────────────────────────────

export async function createAuthSession(
  db: D1Database,
  params: { id: string; phone: string; expires_at: number },
): Promise<void> {
  return safeQuery('createAuthSession', async () => {
    await db
      .prepare(
        'INSERT INTO auth_sessions (id, phone, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(params.id, params.phone, 'pending', Date.now(), params.expires_at)
      .run()
  })
}

export async function getAuthSession(db: D1Database, id: string): Promise<AuthSession | null> {
  return safeQuery('getAuthSession', () =>
    db.prepare('SELECT * FROM auth_sessions WHERE id = ?').bind(id).first<AuthSession>(),
  )
}

export async function getActiveAuthSessionByPhone(
  db: D1Database,
  phone: string,
): Promise<AuthSession | null> {
  return safeQuery('getActiveAuthSessionByPhone', () =>
    db
      .prepare(
        "SELECT * FROM auth_sessions WHERE phone = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
      )
      .bind(phone, Date.now())
      .first<AuthSession>(),
  )
}

export async function setAuthSessionTelegramUser(
  db: D1Database,
  id: string,
  telegramUserId: number,
): Promise<void> {
  return safeQuery('setAuthSessionTelegramUser', async () => {
    await db
      .prepare('UPDATE auth_sessions SET telegram_user_id = ? WHERE id = ?')
      .bind(telegramUserId, id)
      .run()
  })
}

export async function getPendingAuthSessionByTelegramUser(
  db: D1Database,
  telegramUserId: number,
): Promise<AuthSession | null> {
  return safeQuery('getPendingAuthSessionByTelegramUser', () =>
    db
      .prepare(
        "SELECT * FROM auth_sessions WHERE telegram_user_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
      )
      .bind(telegramUserId, Date.now())
      .first<AuthSession>(),
  )
}

export async function markAuthSessionVerified(
  db: D1Database,
  id: string,
  userId: number,
  jwt: string,
): Promise<void> {
  return safeQuery('markAuthSessionVerified', async () => {
    await db
      .prepare("UPDATE auth_sessions SET status = 'verified', user_id = ?, jwt = ? WHERE id = ?")
      .bind(userId, jwt, id)
      .run()
  })
}

export async function markAuthSessionFailed(db: D1Database, id: string): Promise<void> {
  return safeQuery('markAuthSessionFailed', async () => {
    await db
      .prepare("UPDATE auth_sessions SET status = 'failed' WHERE id = ?")
      .bind(id)
      .run()
  })
}

export async function expireOldAuthSessions(db: D1Database): Promise<void> {
  return safeQuery('expireOldAuthSessions', async () => {
    await db
      .prepare("UPDATE auth_sessions SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?")
      .bind(Date.now())
      .run()
  })
}

// ─── Phone users (extends existing users table) ───────────────────────────────

export async function getUserByPhone(db: D1Database, phone: string): Promise<User | null> {
  return safeQuery('getUserByPhone', () =>
    db.prepare('SELECT * FROM users WHERE phone = ?').bind(phone).first<User>(),
  )
}

export async function getUserByTelegramId(
  db: D1Database,
  telegramUserId: number,
): Promise<User | null> {
  return safeQuery('getUserByTelegramId', () =>
    db
      .prepare('SELECT * FROM users WHERE telegram_user_id = ?')
      .bind(telegramUserId)
      .first<User>(),
  )
}

export async function upsertPhoneUser(
  db: D1Database,
  params: {
    phone: string
    telegram_user_id: number
    telegram_username: string | null
    first_name: string | null
    last_name: string | null
  },
): Promise<number> {
  return safeQuery('upsertPhoneUser', async () => {
    const now = Date.now()
    // Try to find existing user by phone
    const existing = await db
      .prepare('SELECT id FROM users WHERE phone = ?')
      .bind(params.phone)
      .first<{ id: number }>()

    if (existing) {
      // Update telegram info and last login
      await db
        .prepare(
          `UPDATE users SET telegram_user_id = ?, telegram_username = ?,
           first_name = COALESCE(first_name, ?), last_name = COALESCE(last_name, ?),
           last_login_at = ? WHERE id = ?`,
        )
        .bind(
          params.telegram_user_id,
          params.telegram_username,
          params.first_name,
          params.last_name,
          now,
          existing.id,
        )
        .run()
      return existing.id
    }

    // Create new phone user (email and password_hash are required in existing schema)
    // Use a synthetic email that is guaranteed unique
    const syntheticEmail = `tg${params.telegram_user_id}@telegram.loom`
    const result = await db
      .prepare(
        `INSERT INTO users (email, password_hash, phone, telegram_user_id, telegram_username,
         first_name, last_name, role, status, created_at, last_login_at)
         VALUES (?, 'telegram_auth', ?, ?, ?, ?, ?, 'customer', 'active', ?, ?)`,
      )
      .bind(
        syntheticEmail,
        params.phone,
        params.telegram_user_id,
        params.telegram_username,
        params.first_name,
        params.last_name,
        now,
        now,
      )
      .run()
    return Number(result.meta.last_row_id)
  })
}

export async function updateUserLastLogin(db: D1Database, userId: number): Promise<void> {
  return safeQuery('updateUserLastLogin', async () => {
    await db
      .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .bind(Date.now(), userId)
      .run()
  })
}

// ─── Activity log ─────────────────────────────────────────────────────────────

export async function insertUserActivity(
  db: D1Database,
  params: { user_id: number; action: string; metadata?: Record<string, unknown> },
): Promise<void> {
  return safeQuery('insertUserActivity', async () => {
    await db
      .prepare('INSERT INTO user_activity_log (user_id, action, metadata, created_at) VALUES (?, ?, ?, ?)')
      .bind(
        params.user_id,
        params.action,
        params.metadata ? JSON.stringify(params.metadata) : null,
        Date.now(),
      )
      .run()
  })
}

export async function getUserActivity(
  db: D1Database,
  userId: number,
  page = 1,
  limit = 25,
): Promise<{ items: Array<{ id: number; action: string; metadata: string | null; created_at: number }>; total: number }> {
  return safeQuery('getUserActivity', async () => {
    const offset = (page - 1) * limit
    const countRow = await db
      .prepare('SELECT COUNT(*) as c FROM user_activity_log WHERE user_id = ?')
      .bind(userId)
      .first<{ c: number }>()
    const total = countRow?.c ?? 0
    const { results } = await db
      .prepare(
        'SELECT id, action, metadata, created_at FROM user_activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      )
      .bind(userId, limit, offset)
      .all<{ id: number; action: string; metadata: string | null; created_at: number }>()
    return { items: results, total }
  })
}

// ─── Admin: Users management ─────────────────────────────────────────────────

export interface AdminUsersFilter {
  q?: string
  role?: string
  status?: string
  page: number
  limit: number
}

export interface AdminUserRow {
  id: number
  phone: string | null
  email: string
  first_name: string | null
  last_name: string | null
  telegram_username: string | null
  telegram_user_id: number | null
  role: string
  status: string
  created_at: number
  last_login_at: number | null
  orders_count: number
  total_spent: number
}

export async function getAdminUsers(
  db: D1Database,
  filter: AdminUsersFilter,
): Promise<{ users: AdminUserRow[]; total: number }> {
  return safeQuery('getAdminUsers', async () => {
    const offset = (filter.page - 1) * filter.limit
    const conditions: string[] = ['u.phone IS NOT NULL']
    const params: (string | number | null)[] = []

    if (filter.q) {
      conditions.push('(u.phone LIKE ? OR u.telegram_username LIKE ? OR u.first_name LIKE ?)')
      params.push(`%${filter.q}%`, `%${filter.q}%`, `%${filter.q}%`)
    }
    if (filter.role) {
      conditions.push('u.role = ?')
      params.push(filter.role)
    }
    if (filter.status) {
      conditions.push('u.status = ?')
      params.push(filter.status)
    }

    const where = `WHERE ${conditions.join(' AND ')}`

    const countRow = await db
      .prepare(`SELECT COUNT(*) as c FROM users u ${where}`)
      .bind(...params)
      .first<{ c: number }>()
    const total = countRow?.c ?? 0

    const { results } = await db
      .prepare(
        `SELECT u.id, u.phone, u.email, u.first_name, u.last_name, u.telegram_username,
                u.telegram_user_id, u.role, u.status, u.created_at, u.last_login_at,
                COUNT(o.id) as orders_count,
                COALESCE(SUM(o.total_price), 0) as total_spent
         FROM users u
         LEFT JOIN orders o ON o.user_id = u.id
         ${where}
         GROUP BY u.id
         ORDER BY u.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(...params, filter.limit, offset)
      .all<AdminUserRow>()

    return { users: results, total }
  })
}

export async function getAdminUserById(db: D1Database, id: number): Promise<AdminUserRow | null> {
  return safeQuery('getAdminUserById', () =>
    db
      .prepare(
        `SELECT u.id, u.phone, u.email, u.first_name, u.last_name, u.telegram_username,
                u.telegram_user_id, u.role, u.status, u.created_at, u.last_login_at,
                COUNT(o.id) as orders_count,
                COALESCE(SUM(o.total_price), 0) as total_spent
         FROM users u
         LEFT JOIN orders o ON o.user_id = u.id
         WHERE u.id = ?
         GROUP BY u.id`,
      )
      .bind(id)
      .first<AdminUserRow>(),
  )
}

export async function updateUserRoleAndStatus(
  db: D1Database,
  id: number,
  params: { role?: string; status?: string },
): Promise<void> {
  return safeQuery('updateUserRoleAndStatus', async () => {
    const sets: string[] = []
    const vals: (string | number)[] = []
    if (params.role !== undefined) { sets.push('role = ?'); vals.push(params.role) }
    if (params.status !== undefined) { sets.push('status = ?'); vals.push(params.status) }
    if (!sets.length) return
    vals.push(id)
    await db
      .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...vals)
      .run()
  })
}

// ─── Admin: Notifications ─────────────────────────────────────────────────────

export async function insertNotification(
  db: D1Database,
  params: {
    user_id: number
    message: string
    button_label: string | null
    button_url: string | null
    telegram_message_id: number | null
    sent_by_admin_id: number
    status: string
    error_detail: string | null
  },
): Promise<number> {
  return safeQuery('insertNotification', async () => {
    const result = await db
      .prepare(
        `INSERT INTO notifications_sent
           (user_id, message, button_label, button_url, telegram_message_id,
            sent_at, sent_by_admin_id, status, error_detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        params.user_id,
        params.message,
        params.button_label,
        params.button_url,
        params.telegram_message_id,
        Date.now(),
        params.sent_by_admin_id,
        params.status,
        params.error_detail,
      )
      .run()
    return Number(result.meta.last_row_id)
  })
}

export async function getNotifications(
  db: D1Database,
  page = 1,
  limit = 25,
): Promise<{ items: NotificationSent[]; total: number }> {
  return safeQuery('getNotifications', async () => {
    const offset = (page - 1) * limit
    const countRow = await db
      .prepare('SELECT COUNT(*) as c FROM notifications_sent')
      .first<{ c: number }>()
    const total = countRow?.c ?? 0
    const { results } = await db
      .prepare('SELECT * FROM notifications_sent ORDER BY sent_at DESC LIMIT ? OFFSET ?')
      .bind(limit, offset)
      .all<NotificationSent>()
    return { items: results, total }
  })
}

// ─── Admin Stats (extended) ───────────────────────────────────────────────────

export interface AdminStatsExtended extends AdminStats {
  totalUsers: number
  newUsersLast7Days: number
  newUsersLast30Days: number
}

export async function getAdminStatsExtended(db: D1Database): Promise<AdminStatsExtended> {
  return safeQuery('getAdminStatsExtended', async () => {
    const base = await getAdminStats(db)
    const now = Date.now()
    const day7ago = now - 7 * 24 * 60 * 60 * 1000
    const day30ago = now - 30 * 24 * 60 * 60 * 1000

    const [totalRow, week7Row, month30Row] = await Promise.all([
      db
        .prepare('SELECT COUNT(*) as c FROM users WHERE phone IS NOT NULL')
        .first<{ c: number }>(),
      db
        .prepare('SELECT COUNT(*) as c FROM users WHERE phone IS NOT NULL AND created_at >= ?')
        .bind(day7ago)
        .first<{ c: number }>(),
      db
        .prepare('SELECT COUNT(*) as c FROM users WHERE phone IS NOT NULL AND created_at >= ?')
        .bind(day30ago)
        .first<{ c: number }>(),
    ])

    return {
      ...base,
      totalUsers: totalRow?.c ?? 0,
      newUsersLast7Days: week7Row?.c ?? 0,
      newUsersLast30Days: month30Row?.c ?? 0,
    }
  })
}

export async function insertOrderStatusLog(
  db: D1Database,
  params: {
    order_id: number
    old_status: string | null
    new_status: string
    changed_by: number | null
    note: string | null
  },
): Promise<void> {
  return safeQuery('insertOrderStatusLog', async () => {
    await db
      .prepare(
        `INSERT INTO order_status_log (order_id, old_status, new_status, changed_by, changed_at, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        params.order_id,
        params.old_status,
        params.new_status,
        params.changed_by,
        Date.now(),
        params.note,
      )
      .run()
  })
}
