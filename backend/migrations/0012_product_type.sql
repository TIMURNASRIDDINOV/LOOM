-- 0012: product type — split catalog into customizable vs ready-made designs
-- 'custom' = goes through the 3D configurator (default, all existing rows)
-- 'ready'  = pre-designed item, bought as-is (size only)
ALTER TABLE products ADD COLUMN product_type TEXT NOT NULL DEFAULT 'custom';
