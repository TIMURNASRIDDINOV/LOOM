-- LOOM-241: one primary marketplace category per artwork. Legacy works stay
-- uncategorized until staff assign them; no historical sale is rewritten.
CREATE TABLE artwork_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ru TEXT NOT NULL,
  name_uz TEXT NOT NULL,
  name_en TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

INSERT INTO artwork_categories (name_ru, name_uz, name_en) VALUES
  ('Иллюстрации', 'Illyustratsiyalar', 'Illustration'),
  ('Надписи', 'Yozuvlar', 'Typography'),
  ('Абстракция', 'Abstraksiya', 'Abstract'),
  ('Природа', 'Tabiat', 'Nature'),
  ('Культура', 'Madaniyat', 'Culture'),
  ('Другое', 'Boshqa', 'Other');

ALTER TABLE artworks ADD COLUMN category_id INTEGER REFERENCES artwork_categories(id);
-- A pending cart must not pay an old price while crediting a new markup.
ALTER TABLE artworks ADD COLUMN price_updated_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_artwork_category_status ON artworks(category_id, status, created_at DESC);
