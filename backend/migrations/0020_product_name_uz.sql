-- 0020 — Uzbek product names.
--
-- `products` shipped with name_ru (required) and name_en (optional) but no
-- Uzbek column, so the catalogue and the configurator showed Russian to every
-- customer regardless of the language they picked. This is the missing third.
--
-- Nullable on purpose: the customer site falls back to Russian when a
-- translation is absent, so an untranslated product keeps working exactly as
-- it does today and can be filled in from admin at any time.

ALTER TABLE products ADD COLUMN name_uz TEXT;
