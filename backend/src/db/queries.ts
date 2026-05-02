// All D1 queries via prepared statements — no string concatenation

import type { Product, User, Admin, Order, OrderStatusLog } from './schema'

// ─── Products ────────────────────────────────────────────────────────────────

export async function getActiveProducts(db: D1Database): Promise<Product[]> {
  const { results } = await db
    .prepare('SELECT * FROM products WHERE active = 1 ORDER BY display_order ASC, id ASC')
    .all<Product>()
  return results
}

export async function getProductById(db: D1Database, id: number): Promise<Product | null> {
  return db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<Product>()
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>()
}

export async function getUserById(db: D1Database, id: number): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>()
}

export async function createUser(
  db: D1Database,
  params: { email: string; password_hash: string; name: string | null; phone: string | null },
): Promise<number> {
  const result = await db
    .prepare(
      'INSERT INTO users (email, password_hash, name, phone, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(params.email, params.password_hash, params.name, params.phone, Date.now())
    .run()
  return Number(result.meta.last_row_id)
}

// ─── Admins ──────────────────────────────────────────────────────────────────

export async function getAdminByEmail(db: D1Database, email: string): Promise<Admin | null> {
  return db.prepare('SELECT * FROM admins WHERE email = ?').bind(email).first<Admin>()
}

export async function getAdminById(db: D1Database, id: number): Promise<Admin | null> {
  return db.prepare('SELECT * FROM admins WHERE id = ?').bind(id).first<Admin>()
}

export async function countAdmins(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) as c FROM admins').first<{ c: number }>()
  return row?.c ?? 0
}

export async function createAdmin(
  db: D1Database,
  params: { email: string; password_hash: string },
): Promise<number> {
  const result = await db
    .prepare('INSERT INTO admins (email, password_hash, created_at) VALUES (?, ?, ?)')
    .bind(params.email, params.password_hash, Date.now())
    .run()
  return Number(result.meta.last_row_id)
}

export async function updateAdminPassword(
  db: D1Database,
  email: string,
  passwordHash: string,
): Promise<void> {
  await db
    .prepare('UPDATE admins SET password_hash = ? WHERE email = ?')
    .bind(passwordHash, email)
    .run()
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
}

export async function getOrderById(db: D1Database, id: number): Promise<Order | null> {
  return db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Order>()
}

export async function getOrdersByUserId(db: D1Database, userId: number): Promise<Order[]> {
  const { results } = await db
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<Order>()
  return results
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
  const offset = (filter.page - 1) * filter.limit
  const conditions: string[] = []
  // D1 bind only accepts string | number | null | boolean
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
}

export async function getOrderStatusLog(
  db: D1Database,
  orderId: number,
): Promise<OrderStatusLog[]> {
  const { results } = await db
    .prepare('SELECT * FROM order_status_log WHERE order_id = ? ORDER BY changed_at ASC')
    .bind(orderId)
    .all<OrderStatusLog>()
  return results
}

export async function updateOrderStatus(
  db: D1Database,
  id: number,
  status: string,
): Promise<void> {
  await db
    .prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, Date.now(), id)
    .run()
}

// ─── Products (admin) ─────────────────────────────────────────────────────────

export async function getProductBySlug(db: D1Database, slug: string): Promise<Product | null> {
  return db.prepare('SELECT * FROM products WHERE slug = ?').bind(slug).first<Product>()
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
}

export async function softDeleteProduct(db: D1Database, id: number): Promise<void> {
  await db
    .prepare('UPDATE products SET active = 0, updated_at = ? WHERE id = ?')
    .bind(Date.now(), id)
    .run()
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
}
