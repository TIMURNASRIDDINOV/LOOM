-- 0031 — Calibrated print area and flat art for products 1, 4, 6 (LOOM-346).
--
-- LOOM-228 (tee) and LOOM-229 (hoodie, sweatshirt) shipped the 2D art under
-- configuratorprodutcs/ but the values were never entered, so these rows still
-- hold the 0022 column defaults (stock T-shirt art, no print box).
--
-- Data only. Each UPDATE is guarded: it changes a row only while that row still
-- holds the old values (slug + old art paths + old print area + no print box).
-- A row an admin already edited is left alone, and on a fresh database (no
-- products) every UPDATE matches nothing. The JSON is byte-for-byte what the
-- admin form stores after checkPrintArea / checkFlatArt (routes/admin-products.ts).
-- updated_at is epoch milliseconds, like queries.ts updateProduct.

UPDATE products
SET print_area_json = '{"platen_cm":{"w":30,"h":40},"width_frac":0.85,"top_frac":0.2}',
    flat_art_json   = '{"front":{"src":"configuratorprodutcs/tshirt_oversized_front_1200.png","src_small":"configuratorprodutcs/tshirt_oversized_front_600.png","print":{"x":0.3328,"y":0.206,"w":0.332}},"back":{"src":"configuratorprodutcs/tshirt_oversized_back_1200.png","src_small":"configuratorprodutcs/tshirt_oversized_back_600.png","print":{"x":0.3463,"y":0.1722,"w":0.3084}}}',
    updated_at      = unixepoch() * 1000
WHERE slug = 'tshirt-regular'
  AND json_extract(print_area_json, '$.platen_cm.w') = 30
  AND json_extract(print_area_json, '$.platen_cm.h') = 40
  AND json_extract(print_area_json, '$.width_frac') = 0.55
  AND json_extract(print_area_json, '$.top_frac') = 0.2
  AND json_extract(flat_art_json, '$.front.src') = 'configuratorprodutcs/tshirt_flat_white_1200.png'
  AND json_extract(flat_art_json, '$.back.src') = 'configuratorprodutcs/tshirt_flat_white_1200.png'
  AND json_extract(flat_art_json, '$.front.print') IS NULL
  AND json_extract(flat_art_json, '$.back.print') IS NULL;

UPDATE products
SET print_area_json = '{"platen_cm":{"w":30,"h":30},"width_frac":0.49,"top_frac":0.25}',
    flat_art_json   = '{"front":{"src":"configuratorprodutcs/hoodie_flat_front_1200.png","src_small":"configuratorprodutcs/hoodie_flat_front_600.png","print":{"x":0.3409,"y":0.2987,"w":0.3189}},"back":{"src":"configuratorprodutcs/hoodie_flat_back_1200.png","src_small":"configuratorprodutcs/hoodie_flat_back_600.png","print":{"x":0.3466,"y":0.2324,"w":0.3058}}}',
    updated_at      = unixepoch() * 1000
WHERE slug = 'hoodie-regular'
  AND json_extract(print_area_json, '$.platen_cm.w') = 30
  AND json_extract(print_area_json, '$.platen_cm.h') = 40
  AND json_extract(print_area_json, '$.width_frac') = 0.55
  AND json_extract(print_area_json, '$.top_frac') = 0.2
  AND json_extract(flat_art_json, '$.front.src') = 'configuratorprodutcs/tshirt_flat_white_1200.png'
  AND json_extract(flat_art_json, '$.back.src') = 'configuratorprodutcs/tshirt_flat_white_1200.png'
  AND json_extract(flat_art_json, '$.front.print') IS NULL
  AND json_extract(flat_art_json, '$.back.print') IS NULL;

UPDATE products
SET print_area_json = '{"platen_cm":{"w":30,"h":40},"width_frac":0.485,"top_frac":0.25}',
    flat_art_json   = '{"front":{"src":"configuratorprodutcs/sweatshirt_flat_v2_front_1200.png","src_small":"configuratorprodutcs/sweatshirt_flat_v2_front_600.png","print":{"x":0.3152,"y":0.2282,"w":0.3663}},"back":{"src":"configuratorprodutcs/sweatshirt_flat_v2_back_1200.png","src_small":"configuratorprodutcs/sweatshirt_flat_v2_back_600.png","print":{"x":0.3401,"y":0.1522,"w":0.3225}}}',
    updated_at      = unixepoch() * 1000
WHERE slug = 'sweatshirt'
  AND json_extract(print_area_json, '$.platen_cm.w') = 30
  AND json_extract(print_area_json, '$.platen_cm.h') = 40
  AND json_extract(print_area_json, '$.width_frac') = 0.55
  AND json_extract(print_area_json, '$.top_frac') = 0.2
  AND json_extract(flat_art_json, '$.front.src') = 'configuratorprodutcs/sweatshirt_flat_front_1200.png'
  AND json_extract(flat_art_json, '$.back.src') = 'configuratorprodutcs/sweatshirt_flat_back_1200.png'
  AND json_extract(flat_art_json, '$.front.print') IS NULL
  AND json_extract(flat_art_json, '$.back.print') IS NULL;

-- Rollback (run by hand with `wrangler d1 execute loom-db --remote --command ...`
-- or a file; values = production on 2026-11-17). Same guard idea in reverse:
-- only rows that still hold the values this migration wrote.
--
-- UPDATE products SET
--   print_area_json = '{"platen_cm":{"w":30,"h":40},"width_frac":0.55,"top_frac":0.2}',
--   flat_art_json = '{"front":{"src":"configuratorprodutcs/tshirt_flat_white_1200.png","src_small":"configuratorprodutcs/tshirt_flat_white_600.png"},"back":{"src":"configuratorprodutcs/tshirt_flat_white_1200.png","src_small":"configuratorprodutcs/tshirt_flat_white_600.png"}}',
--   updated_at = unixepoch() * 1000
-- WHERE slug = 'tshirt-regular'
--   AND json_extract(flat_art_json, '$.front.src') = 'configuratorprodutcs/tshirt_oversized_front_1200.png'
--   AND json_extract(print_area_json, '$.width_frac') = 0.85;
--
-- UPDATE products SET
--   print_area_json = '{"platen_cm":{"w":30,"h":40},"width_frac":0.55,"top_frac":0.2}',
--   flat_art_json = '{"front":{"src":"configuratorprodutcs/tshirt_flat_white_1200.png","src_small":"configuratorprodutcs/tshirt_flat_white_600.png"},"back":{"src":"configuratorprodutcs/tshirt_flat_white_1200.png","src_small":"configuratorprodutcs/tshirt_flat_white_600.png"}}',
--   updated_at = unixepoch() * 1000
-- WHERE slug = 'hoodie-regular'
--   AND json_extract(flat_art_json, '$.front.src') = 'configuratorprodutcs/hoodie_flat_front_1200.png'
--   AND json_extract(print_area_json, '$.width_frac') = 0.49;
--
-- UPDATE products SET
--   print_area_json = '{"platen_cm":{"w":30,"h":40},"width_frac":0.55,"top_frac":0.2}',
--   flat_art_json = '{"front":{"src":"configuratorprodutcs/sweatshirt_flat_front_1200.png","src_small":"configuratorprodutcs/sweatshirt_flat_front_600.png"},"back":{"src":"configuratorprodutcs/sweatshirt_flat_back_1200.png","src_small":"configuratorprodutcs/sweatshirt_flat_back_600.png"}}',
--   updated_at = unixepoch() * 1000
-- WHERE slug = 'sweatshirt'
--   AND json_extract(flat_art_json, '$.front.src') = 'configuratorprodutcs/sweatshirt_flat_v2_front_1200.png'
--   AND json_extract(print_area_json, '$.width_frac') = 0.485;
--
-- The rollback does not remove this migration from d1_migrations; that is fine
-- because the forward UPDATEs never run twice.
