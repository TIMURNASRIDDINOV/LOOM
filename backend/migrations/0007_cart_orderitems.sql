-- ================================================================
-- LOOM Backend — Account cart + multi-item orders (Phase 2)
-- Apply local:  wrangler d1 execute loom-db --local  --file migrations/0007_cart_orderitems.sql
-- Apply prod:   wrangler d1 execute loom-db --remote --file migrations/0007_cart_orderitems.sql
-- ================================================================

-- Per-user cart (account-bound). One row per design added to the cart.
CREATE TABLE IF NOT EXISTS cart_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  product_id  INTEGER REFERENCES products(id),
  design_json TEXT    NOT NULL,            -- full design state JSON
  logo_key    TEXT,                        -- R2 key in loom-uploads (optional)
  unit_price  INTEGER NOT NULL,            -- price per unit, in UZS
  quantity    INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(user_id);

-- Line items of a multi-item order. The `orders` row remains the order header
-- (customer, address, total, status); its design_json holds a multi-item summary.
CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  product_id   INTEGER REFERENCES products(id),
  product_name TEXT,
  design_json  TEXT    NOT NULL,
  logo_key     TEXT,
  unit_price   INTEGER NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orderitems_order ON order_items(order_id);
