-- ================================================================
-- LOOM — Funnel events on page_visits
-- Apply: wrangler d1 execute loom-db --remote --file migrations/0016_visit_events.sql
-- ----------------------------------------------------------------
-- Until now page_visits held one row per page load and nothing about what the
-- visitor did once they arrived, so the configurator funnel was invisible.
-- `event` is NULL for a plain pageview, which keeps every existing row and
-- every existing query correct without a backfill.
-- ================================================================

ALTER TABLE page_visits ADD COLUMN event TEXT;

-- Funnel queries filter on the event first, then group by session.
CREATE INDEX IF NOT EXISTS idx_visits_event ON page_visits(event, visited_at DESC);
