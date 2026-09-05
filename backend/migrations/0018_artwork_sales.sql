-- Designer marketplace: sales attribution.
--
-- Migration 0017 gave designers a place to upload artwork and a markup to charge
-- for it, but nothing recorded WHICH orders used WHICH artwork. Without that
-- there is no way to show a designer their earnings or to pay out commission,
-- so the marketplace promise in the app ("вы получаете процент с каждой
-- продажи") was not backed by data.
--
-- One row per (order item × artwork). Written at checkout from the design_json
-- elements that carry an `artworkId`. The designer's share is frozen at sale
-- time so a later change to the commission rate never rewrites history.

CREATE TABLE IF NOT EXISTS artwork_sales (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES orders(id),
  order_item_id     INTEGER REFERENCES order_items(id),
  artwork_id        INTEGER NOT NULL REFERENCES artworks(id),
  designer_user_id  INTEGER NOT NULL REFERENCES users(id),
  quantity          INTEGER NOT NULL DEFAULT 1,
  markup            INTEGER NOT NULL,            -- UZS per unit, as charged to the buyer
  commission_pct    INTEGER NOT NULL DEFAULT 30, -- LOOM's cut of the markup, percent
  designer_share    INTEGER NOT NULL,            -- UZS total owed to the designer for this row
  created_at        INTEGER NOT NULL
);

-- Designer earnings page: everything a designer sold, newest first.
CREATE INDEX IF NOT EXISTS idx_artwork_sales_designer ON artwork_sales(designer_user_id, created_at DESC);
-- Per-artwork sales counters on the marketplace card and in moderation.
CREATE INDEX IF NOT EXISTS idx_artwork_sales_artwork  ON artwork_sales(artwork_id);
CREATE INDEX IF NOT EXISTS idx_artwork_sales_order    ON artwork_sales(order_id);
