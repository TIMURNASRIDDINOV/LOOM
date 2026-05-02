-- ================================================================
-- LOOM Backend — Seed
-- Creates the first admin row with a placeholder password.
-- After applying, use POST /api/admin/setup to set the real password,
-- OR update manually:
--   wrangler d1 execute loom-db --local --command \
--   "UPDATE admins SET password_hash='<hash>' WHERE email='admin@looom.me'"
-- See README.md for how to generate a PBKDF2 hash.
-- ================================================================

INSERT OR IGNORE INTO admins (email, password_hash, created_at)
VALUES (
  'admin@looom.me',
  'PLACEHOLDER_USE_SETUP_ENDPOINT',
  unixepoch() * 1000
);
