-- 0032 — Site settings (key-value) for content the owner changes from the
-- admin panel without a code deploy (LOOM home-hero ticket). First key:
-- 'home_hero' = JSON {"key": "<R2 key in LOOM_MODELS>", "alt": "<text>"}.
-- No row = the static default picture baked into index.html.

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by INTEGER REFERENCES admins(id),
  updated_at TEXT NOT NULL
);
