-- ================================================================
-- LOOM Backend — multi-provider AI ledger (Workers AI + Google Gemini)
-- Apply local:  wrangler d1 execute loom-db --local  --file migrations/0014_ai_provider.sql
-- Apply prod:   wrangler d1 execute loom-db --remote --file migrations/0014_ai_provider.sql
-- ================================================================
--
-- The spike gains a second, PAID provider (Google Gemini image / "Nano Banana"),
-- billed in dollars, not neurons. The ledger now records which provider a row
-- belongs to and its dollar cost, so the budget guard can enforce a separate
-- USD cap alongside the existing neuron cap.
--
-- Both columns default so every existing row reads back as a free Workers AI
-- generation (provider 'workers-ai', $0.00) — no backfill needed.

ALTER TABLE ai_usage ADD COLUMN provider     TEXT NOT NULL DEFAULT 'workers-ai';
ALTER TABLE ai_usage ADD COLUMN est_cost_usd REAL NOT NULL DEFAULT 0;

-- The USD budget guard sums est_cost_usd over the current UTC day, filtered by
-- provider, on every generate request.
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_created ON ai_usage(provider, created_at);
