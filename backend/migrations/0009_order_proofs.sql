-- ================================================================
-- LOOM Backend — Order production proofs + print artwork + approval
-- Apply local:  wrangler d1 execute loom-db --local  --file migrations/0009_order_proofs.sql
-- Apply prod:   wrangler d1 execute loom-db --remote --file migrations/0009_order_proofs.sql
-- ================================================================
--
-- Adds the assets an admin needs to review and reprint a design EXACTLY:
--   *_print_key   — flat 2048² print artwork PNG (shadow-free, the print master)
--   *_mockup_key  — 3D garment mockup JPEG (what the customer saw)
--   back_logo_key — second uploaded logo (existing logo_key = front logo)
-- and a production-approval gate on the order header.
--
-- All columns are nullable; existing rows keep NULL (legacy orders show a
-- reconstruction in the admin panel instead of a saved print master).

-- ── orders (single-design / header) ──────────────────────────────
ALTER TABLE orders ADD COLUMN front_print_key   TEXT;
ALTER TABLE orders ADD COLUMN back_print_key    TEXT;
ALTER TABLE orders ADD COLUMN front_mockup_key  TEXT;
ALTER TABLE orders ADD COLUMN back_mockup_key   TEXT;
ALTER TABLE orders ADD COLUMN back_logo_key     TEXT;
ALTER TABLE orders ADD COLUMN proof_approved_at INTEGER;            -- epoch ms, NULL = not approved
ALTER TABLE orders ADD COLUMN proof_approved_by INTEGER REFERENCES admins(id);

-- ── order_items (per line item of a cart checkout) ───────────────
ALTER TABLE order_items ADD COLUMN front_print_key  TEXT;
ALTER TABLE order_items ADD COLUMN back_print_key   TEXT;
ALTER TABLE order_items ADD COLUMN front_mockup_key TEXT;
ALTER TABLE order_items ADD COLUMN back_mockup_key  TEXT;
ALTER TABLE order_items ADD COLUMN back_logo_key    TEXT;

-- ── cart_items (proofs captured while the design is still live) ──
ALTER TABLE cart_items ADD COLUMN front_print_key  TEXT;
ALTER TABLE cart_items ADD COLUMN back_print_key   TEXT;
ALTER TABLE cart_items ADD COLUMN front_mockup_key TEXT;
ALTER TABLE cart_items ADD COLUMN back_mockup_key  TEXT;
ALTER TABLE cart_items ADD COLUMN back_logo_key    TEXT;
