-- ================================================================
-- LOOM Backend — Workers AI neuron budget ledger
-- Apply local:  wrangler d1 execute loom-db --local  --file migrations/0013_ai_usage.sql
-- Apply prod:   wrangler d1 execute loom-db --remote --file migrations/0013_ai_usage.sql
-- ================================================================
--
-- One row per dispatched env.AI.run() call in the admin model-comparison
-- harness. Rows are written for FAILED calls too: a generation that errors
-- upstream can still have burned neurons, and refusing to count it is how a
-- test run silently pushes past the free tier.
--
-- `est_neurons` is our own estimate (lib/ai-models.ts), not Cloudflare's
-- billed figure — the daily cap sits below the free tier to absorb the drift.
-- Free tier: 10,000 neurons/day, resets 00:00 UTC.

CREATE TABLE IF NOT EXISTS ai_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  model       TEXT    NOT NULL,           -- Workers AI model id
  est_neurons INTEGER NOT NULL,           -- estimated cost of this single image
  run_id      TEXT    NOT NULL,           -- groups the images of one generate request
  prompt      TEXT    NOT NULL,
  created_at  INTEGER NOT NULL            -- epoch ms
);

-- The budget guard sums est_neurons over the current UTC day on every generate
-- request, so this index is on the hot path.
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage(created_at);

-- Result grids are fetched per run.
CREATE INDEX IF NOT EXISTS idx_ai_usage_run_id ON ai_usage(run_id);
