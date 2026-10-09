-- 0022 — Per-product configurator config (LOOM-165).
--
-- Sizes, garment colours, print geometry and flat-editor art were hardcoded in
-- configurator.html / configurator.js (and mirrored in mobile scene-html.ts).
-- They now live on the product row so the founder can set them per product.
--
-- Additive only. Each JSON column carries today's hardcoded values as its
-- DEFAULT, which SQLite applies to every existing row, so the catalogue
-- renders exactly as before until a product is edited. Shapes are validated
-- server-side in routes/admin-products.ts:
--   sizes_json       ["XS","S",...]
--   colors_json      [{hex:"#RRGGBB", name_uz, name_ru, name_en, available}]
--   print_area_json  {platen_cm:{w,h}, width_frac, top_frac}
--   flat_art_json    {front:{src,src_small}, back:{src,src_small}}
--
-- Values, from origin/main at the time of writing:
--   sizes       configurator.html #size-selector buttons
--   colors      configurator.js SHIRT_COLORS + names from assets/i18n.js
--               (cfg.colorWhite / cfg.colorBlack)
--   print_area  configurator.js PLATEN_CM, PLATEN_W_FRAC, PLATEN_TOP_FRAC
--   flat_art    configurator.js FLAT_ART (back is derived from the front art)

ALTER TABLE products ADD COLUMN description_uz TEXT;
ALTER TABLE products ADD COLUMN description_en TEXT;

ALTER TABLE products ADD COLUMN sizes_json TEXT
  DEFAULT '["XS","S","M","L","XL","XXL","XXXL"]';

ALTER TABLE products ADD COLUMN colors_json TEXT
  DEFAULT '[{"hex":"#FFFFFF","name_uz":"Oq","name_ru":"Белый","name_en":"White","available":true},{"hex":"#000000","name_uz":"Qora","name_ru":"Чёрный","name_en":"Black","available":true}]';

ALTER TABLE products ADD COLUMN print_area_json TEXT
  DEFAULT '{"platen_cm":{"w":30,"h":40},"width_frac":0.55,"top_frac":0.2}';

ALTER TABLE products ADD COLUMN flat_art_json TEXT
  DEFAULT '{"front":{"src":"configuratorprodutcs/tshirt_flat_white_1200.png","src_small":"configuratorprodutcs/tshirt_flat_white_600.png"},"back":{"src":"configuratorprodutcs/tshirt_flat_white_1200.png","src_small":"configuratorprodutcs/tshirt_flat_white_600.png"}}';
