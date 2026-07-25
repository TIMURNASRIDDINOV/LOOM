-- 0015: Per-admin capability overrides on top of the role presets.
--
-- Roles (owner|manager|staff, migration 0008) now only choose a DEFAULT set of
-- capabilities; see backend/src/lib/permissions.ts for the catalog and presets.
-- This table records the owner's per-person deviations from that default:
--
--   granted = 1  → capability added on top of the role preset
--   granted = 0  → capability removed from the role preset
--   no row       → inherit whatever the role preset says
--
-- Effective set = preset(role) ∪ {granted=1} \ {granted=0}. The owner role
-- short-circuits to every capability and ignores this table entirely, so no
-- combination of rows here can lock the owner out.
--
-- An empty table is exactly the pre-0015 behaviour, which is why this migration
-- seeds nothing: every existing admin keeps the access they had.

CREATE TABLE IF NOT EXISTS admin_permissions (
  admin_id   INTEGER NOT NULL,
  capability TEXT    NOT NULL,
  granted    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER,
  PRIMARY KEY (admin_id, capability),
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_permissions_admin ON admin_permissions(admin_id);
