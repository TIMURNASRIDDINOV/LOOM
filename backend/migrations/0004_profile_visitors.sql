-- ================================================================
-- LOOM — Profile extensions + Visitor analytics
-- Apply: wrangler d1 execute loom-db --remote --file migrations/0004_profile_visitors.sql
-- ================================================================

-- Extend users table with avatar and preset location
ALTER TABLE users ADD COLUMN avatar_key      TEXT;
ALTER TABLE users ADD COLUMN location_preset TEXT; -- JSON: {"address":"...","lat":41.3,"lng":69.2}

-- Visitor analytics (session = one browser tab lifecycle, tracked client-side)
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
