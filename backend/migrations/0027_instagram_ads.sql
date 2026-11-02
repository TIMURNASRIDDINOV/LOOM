-- LOOM-276 (PRD-213 R-11, R-12): paused, budget-capped ads for published
-- Instagram posts. Additive only.
--
-- One row per attempt to create campaign, ad set and ad in the Marketing API.
-- The ids are saved as each one is made, so a partial failure keeps what Meta
-- already has. Times are UTC ISO 8601 text, like ig_posts.
CREATE TABLE IF NOT EXISTS ig_ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ig_post_id INTEGER NOT NULL REFERENCES ig_posts(id),
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  budget_usd_cents INTEGER NOT NULL CHECK (budget_usd_cents > 0),
  budget_type TEXT NOT NULL DEFAULT 'lifetime' CHECK (budget_type IN ('lifetime', 'daily')),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  -- Last effective_status read from the Marketing API (GET /api/admin/instagram/ads).
  status_seen TEXT,
  created_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_ig_ads_end ON ig_ads(end_at);

-- Monthly cap in USD. Code never allows more than 60 (lib/instagram-ads.ts).
INSERT OR IGNORE INTO ig_settings (key, value, updated_by, updated_at)
  VALUES ('ads_monthly_cap_usd', '60', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Targeting for new ad sets. genders: [] = all, 1 = men, 2 = women.
-- interests: [{ "id": "...", "name": "..." }] from Meta's targeting search.
INSERT OR IGNORE INTO ig_settings (key, value, updated_by, updated_at)
  VALUES ('ads_targeting', '{"countries":["UZ"],"age_min":18,"age_max":35,"genders":[],"interests":[]}', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
