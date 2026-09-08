-- 0019 — per-account notification preferences.
--
-- The website and the app have shown "Статус заказа" / "Акции и новинки"
-- switches since the cabinet was built, but they were written to
-- localStorage and read by nobody: turning them off changed nothing, and
-- they were per-browser rather than per-account. These two columns are what
-- the switches actually set, and POST /api/admin/notifications now refuses
-- to send a category the customer has turned off.
--
-- Default 1 on both: an existing customer has not opted out of anything, and
-- silently muting people on migration would be the worse failure.

ALTER TABLE users ADD COLUMN notify_orders INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN notify_promo  INTEGER NOT NULL DEFAULT 1;
