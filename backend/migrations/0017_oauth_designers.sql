-- Federated sign-in (Google / Facebook / Discord) and designer accounts.
--
-- Until now a user could only arrive through email+password or the Telegram
-- phone flow. The mobile app adds social sign-in, and the designer marketplace
-- needs somewhere to keep uploaded artwork and its moderation state.

-- ─── Federated identities ────────────────────────────────────────────────────
-- One row per (provider, provider_user_id). A single LOOM account can carry
-- several identities, so signing in with Google and later with Discord on the
-- same verified email lands on one account rather than two.
CREATE TABLE IF NOT EXISTS user_identities (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  provider         TEXT    NOT NULL,          -- 'google' | 'facebook' | 'discord'
  provider_user_id TEXT    NOT NULL,          -- the provider's immutable subject id
  email            TEXT,                      -- as reported by the provider, may be null
  avatar_url       TEXT,
  created_at       INTEGER NOT NULL
);

-- The lookup every sign-in does, and the constraint that stops one provider
-- account being attached to two LOOM users.
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_provider_subject
  ON user_identities(provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_identity_user ON user_identities(user_id);

-- ─── Designers ───────────────────────────────────────────────────────────────
-- Any signed-in user can opt in to become a designer; `is_designer` is what
-- gates the upload flow in the app.
ALTER TABLE users ADD COLUMN is_designer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN designer_handle TEXT;   -- '@ozod', shown on artwork cards
ALTER TABLE users ADD COLUMN designer_bio TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_designer_handle
  ON users(designer_handle) WHERE designer_handle IS NOT NULL;

-- ─── Artwork ─────────────────────────────────────────────────────────────────
-- A designer's uploaded graphic. `markup` is the designer's cut in UZS, added
-- on top of the garment price when a buyer applies the artwork in the studio.
-- Nothing reaches the marketplace until status = 'approved'.
CREATE TABLE IF NOT EXISTS artworks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  title       TEXT    NOT NULL,
  tags        TEXT,                                  -- free-form, comma separated
  image_key   TEXT    NOT NULL,                      -- R2 key in loom-uploads
  width       INTEGER,
  height      INTEGER,
  markup      INTEGER NOT NULL DEFAULT 0,            -- UZS added to the garment price
  status      TEXT    NOT NULL DEFAULT 'pending',    -- pending|approved|rejected
  reject_note TEXT,
  reviewed_by INTEGER REFERENCES admins(id),
  reviewed_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- The marketplace lists approved artwork newest-first; the designer's own page
-- lists everything they have submitted.
CREATE INDEX IF NOT EXISTS idx_artwork_status ON artworks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artwork_user ON artworks(user_id, created_at DESC);
