-- ================================================================
-- LOOM Backend — Interactive 3D review model per order
-- Apply local:  wrangler d1 execute loom-db --local  --file migrations/0010_order_model.sql
-- Apply prod:   wrangler d1 execute loom-db --remote --file migrations/0010_order_model.sql
-- ================================================================
--
-- Stores the textured garment exported as a .glb (binary glTF) at order time —
-- the EXACT model the customer designed, baked textures and all. The admin loads
-- it in an interactive viewer (rotate/zoom) and can download the .glb. Nullable;
-- legacy orders fall back to the flat print artwork + reconstruction.

ALTER TABLE orders      ADD COLUMN model_key TEXT;
ALTER TABLE order_items ADD COLUMN model_key TEXT;
ALTER TABLE cart_items  ADD COLUMN model_key TEXT;
