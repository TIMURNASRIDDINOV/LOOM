-- LOOM-269 (PRD-213): Instagram posts and their settings. Additive only.
--
-- Times in this table are UTC ISO-8601 text (not unix integers like older
-- tables) so publish_at sorts as text and the PRD metric query
-- strftime('%W', published_at) works without conversion.
-- A post publishes only from status approved with approved_by set (R-1).
CREATE TABLE IF NOT EXISTS ig_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caption_uz TEXT NOT NULL DEFAULT '',
  caption_ru TEXT NOT NULL DEFAULT '',
  caption_en TEXT NOT NULL DEFAULT '',
  -- Comma list of the captions to include, always in uz,ru,en order.
  langs TEXT NOT NULL DEFAULT 'uz,ru,en',
  media_key TEXT,
  media_url TEXT,
  publish_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'publishing', 'published', 'failed', 'rejected')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  ig_container_id TEXT,
  ig_media_id TEXT,
  permalink TEXT,
  created_by INTEGER REFERENCES admins(id),
  approved_by INTEGER REFERENCES admins(id),
  approved_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ig_posts_status_publish ON ig_posts(status, publish_at);

CREATE TABLE IF NOT EXISTS ig_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by INTEGER REFERENCES admins(id),
  updated_at TEXT NOT NULL
);

-- Kill switch (R-2): publishing starts paused until the owner switches it on.
INSERT OR IGNORE INTO ig_settings (key, value, updated_by, updated_at)
  VALUES ('publish_paused', '1', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
