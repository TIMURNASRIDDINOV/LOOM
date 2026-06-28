-- ================================================================
-- LOOM Backend — Initial Schema
-- Apply: wrangler d1 execute loom-db --local --file migrations/0001_initial.sql
-- ================================================================

CREATE TABLE IF NOT EXISTS products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT    UNIQUE NOT NULL,
  name_ru        TEXT    NOT NULL,
  name_en        TEXT,
  description_ru TEXT,
  price          INTEGER NOT NULL,           -- in UZS (sums)
  glb_key        TEXT,                       -- R2 key in loom-models
  thumbnail_key  TEXT,                       -- R2 key in loom-uploads
  base_colors    TEXT,                       -- JSON: ["#FFFFFF","#1F2937"]
  active         INTEGER NOT NULL DEFAULT 1,
  display_order  INTEGER          DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,            -- pbkdf2$iterations$salt$hash
  name          TEXT,
  phone         TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER REFERENCES users(id),    -- NULL for anonymous
  product_id     INTEGER REFERENCES products(id),
  customer_name  TEXT    NOT NULL,
  customer_phone TEXT    NOT NULL,
  address        TEXT,
  coordinates    TEXT,                            -- "41.2995,69.2401" or NULL
  comment        TEXT,
  design_json    TEXT    NOT NULL,                -- full designState as JSON
  logo_key       TEXT,                            -- R2 key in loom-uploads
  total_price    INTEGER NOT NULL,                -- in UZS
  status         TEXT    NOT NULL DEFAULT 'new',  -- see ORDER_STATUSES
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_status_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  old_status TEXT,
  new_status TEXT    NOT NULL,
  changed_by INTEGER REFERENCES admins(id),
  changed_at INTEGER NOT NULL,
  note       TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_user_id    ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_slug     ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_active   ON products(active);
CREATE INDEX IF NOT EXISTS idx_status_log_order  ON order_status_log(order_id);
