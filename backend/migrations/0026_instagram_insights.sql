-- LOOM-273 (PRD-213 R-9): Instagram insights pulled weekly by the Worker cron. Additive only.
--
-- Meta keeps user metrics for 90 days, so this table is the system of record.
-- scope 'media' rows carry ig_media_id and period 'lifetime' with no end_time;
-- scope 'account' rows are daily values with ig_media_id NULL and Meta's end_time.
-- Missing data is no row, never 0. Times are UTC ISO-8601 text like ig_posts.
CREATE TABLE IF NOT EXISTS ig_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK (scope IN ('account', 'media')),
  ig_media_id TEXT,
  metric TEXT NOT NULL,
  period TEXT NOT NULL,
  end_time TEXT,
  value INTEGER NOT NULL,
  fetched_at TEXT NOT NULL
);

-- The upsert key. SQLite treats NULLs as distinct in a plain UNIQUE, so the
-- nullable columns are folded to '' or a second pull would add duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ig_insights_key
  ON ig_insights(scope, COALESCE(ig_media_id, ''), metric, period, COALESCE(end_time, ''));
