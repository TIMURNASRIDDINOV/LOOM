-- Apply locally first; the founder applies this additive migration remotely.
ALTER TABLE orders ADD COLUMN idempotency_key TEXT;
ALTER TABLE orders ADD COLUMN session_id TEXT;
CREATE UNIQUE INDEX idx_order_attempt ON orders(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Stable line identity inside the checkout batch; existing orders stay valid.
ALTER TABLE order_items ADD COLUMN source_cart_item_id INTEGER;
CREATE UNIQUE INDEX idx_order_cart_line ON order_items(order_id, source_cart_item_id)
  WHERE source_cart_item_id IS NOT NULL;
CREATE UNIQUE INDEX idx_artwork_sale_line ON artwork_sales(order_item_id, artwork_id);
