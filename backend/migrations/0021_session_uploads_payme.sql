-- 0021: session revocation, upload ownership, Payme transaction ledger.
-- Additive only. Run it BEFORE deploying the Worker that reads these tables
-- (uploads and Payme callbacks write to them).

-- Tokens issued (JWT iat, unix seconds) before this moment are rejected.
-- Bumped on logout, password change/reset. 0 = no cutoff.
ALTER TABLE users  ADD COLUMN tokens_valid_after INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN tokens_valid_after INTEGER NOT NULL DEFAULT 0;

-- Who uploaded each object in the uploads bucket (POST /api/uploads).
-- Routes that persist a client-supplied storage key check it against this.
CREATE TABLE IF NOT EXISTS uploads (
  key        TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_uploads_created ON uploads(created_at);

CREATE INDEX IF NOT EXISTS idx_artworks_image_key ON artworks(image_key);

-- Payme Merchant API transactions. One row per Payme transaction id; the
-- state column follows Payme's lifecycle (1 created, 2 performed,
-- -1 cancelled before perform, -2 cancelled after perform).
CREATE TABLE IF NOT EXISTS payme_transactions (
  id           TEXT PRIMARY KEY,           -- Payme transaction id
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  amount       INTEGER NOT NULL,           -- tiyin
  state        INTEGER NOT NULL,
  payme_time   INTEGER NOT NULL,           -- ms, as sent by Payme
  create_time  INTEGER NOT NULL,           -- ms
  perform_time INTEGER NOT NULL DEFAULT 0,
  cancel_time  INTEGER NOT NULL DEFAULT 0,
  reason       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_payme_tx_order ON payme_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payme_tx_time ON payme_transactions(payme_time);
