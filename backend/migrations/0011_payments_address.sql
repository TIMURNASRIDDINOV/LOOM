-- 0011: payment-gateway readiness + structured delivery address
-- Payment: status is SEPARATE from fulfillment status. Orders keep flowing
-- new→confirmed→…; payment_status tracks money independently so a gateway
-- (Payme / Click / Uzum) can flip it from a webhook without touching fulfillment.
ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cod';        -- cod | payme | click | uzum
ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid';     -- unpaid | pending | paid | refunded | failed
ALTER TABLE orders ADD COLUMN payment_provider_ref TEXT;                          -- provider transaction id
ALTER TABLE orders ADD COLUMN paid_at INTEGER;                                    -- unix seconds

-- Structured address (replaces the lat,lng-in-a-string "coordinates" hack;
-- the old column stays for backward compat and keeps receiving a mirror value)
ALTER TABLE orders ADD COLUMN address_lat REAL;
ALTER TABLE orders ADD COLUMN address_lng REAL;
ALTER TABLE orders ADD COLUMN address_details TEXT;                               -- JSON: {entrance, apartment, floor, intercom, note}

CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
