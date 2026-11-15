-- 0030: 100% prepayment by card transfer (PRD-216, LOOM-323).
-- Additive only: the old Worker keeps working and old orders keep
-- payment_method = 'cod' with delivery_fee = 0. The founder applies it remotely.
-- Existing columns reused: payment_method (new value 'p2p'),
-- payment_status (unpaid -> pending -> paid | failed), paid_at.
ALTER TABLE orders ADD COLUMN delivery_fee INTEGER NOT NULL DEFAULT 0;  -- so'm, part of total_price
ALTER TABLE orders ADD COLUMN pay_deadline INTEGER;       -- ms; unpaid past this = cancelled by the sweep
ALTER TABLE orders ADD COLUMN receipt_key TEXT;           -- private R2 key of the transfer screenshot
ALTER TABLE orders ADD COLUMN receipt_at INTEGER;
ALTER TABLE orders ADD COLUMN pay_reminded_at INTEGER;    -- the "5 minutes left" message was sent
ALTER TABLE orders ADD COLUMN pay_checked_by INTEGER;     -- admin id who confirmed / rejected
ALTER TABLE orders ADD COLUMN pay_checked_at INTEGER;
ALTER TABLE orders ADD COLUMN pay_reject_reason TEXT;     -- not_found | amount_mismatch
ALTER TABLE users ADD COLUMN delete_requested_at INTEGER; -- account deletion waits for open orders
CREATE INDEX IF NOT EXISTS idx_orders_pay_sweep ON orders(payment_status, pay_deadline);
