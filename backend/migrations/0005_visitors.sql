-- ================================================================
-- LOOM — Visitor analytics table
-- Apply: wrangler d1 execute loom-db --remote --file migrations/0005_visitors.sql
-- ================================================================

CREATE TABLE IF NOT EXISTS page_visits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  page        TEXT    NOT NULL DEFAULT '/',
  device_type TEXT,   -- 'mobile' | 'tablet' | 'desktop'
  os          TEXT,   -- 'android' | 'ios' | 'windows' | 'mac' | 'linux' | 'other'
  browser     TEXT,   -- 'chrome' | 'safari' | 'firefox' | 'edge' | 'samsung' | 'other'
  referrer    TEXT,
  visited_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visits_visited_at ON page_visits(visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_session    ON page_visits(session_id);
CREATE INDEX IF NOT EXISTS idx_visits_page       ON page_visits(page);
