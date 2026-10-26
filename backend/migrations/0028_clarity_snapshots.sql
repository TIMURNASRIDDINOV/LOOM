-- LOOM-286: daily Microsoft Clarity Data Export snapshots for the admin Overview. Additive only.
--
-- The Worker cron (0 2 * * *, lib/clarity.ts) makes 4 requests with numOfDays=1
-- and writes one row per request, failures included. `dimensions` is the
-- comma-joined dimension list ('' = no dimension, 'URL', 'Device',
-- 'Source,Medium,Campaign'). `status` is the HTTP status, 0 when the request
-- never got an answer. `body` is Clarity's JSON with every URL reduced to its
-- path (no query string, no fragment); NULL when the request failed.
-- Aggregates only: no user- or session-level dimension is ever requested.
-- Times are UTC ISO-8601 text like ig_posts.
CREATE TABLE IF NOT EXISTS clarity_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at TEXT NOT NULL,
  dimensions TEXT NOT NULL,
  num_days INTEGER NOT NULL,
  status INTEGER NOT NULL,
  body TEXT
);

-- The admin readout asks for the newest row per dimension set.
CREATE INDEX IF NOT EXISTS idx_clarity_snapshots_dims ON clarity_snapshots(dimensions, fetched_at);
