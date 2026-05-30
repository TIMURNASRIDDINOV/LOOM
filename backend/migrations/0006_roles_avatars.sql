-- ================================================================
-- LOOM — Role rename (customer → user)
-- Apply: wrangler d1 execute loom-db --local --file migrations/0006_roles_avatars.sql
--        wrangler d1 execute loom-db --file migrations/0006_roles_avatars.sql
--
-- NOTE: The original version of this file also re-added the
-- avatar_key column that 0004 had already created, causing
-- "duplicate column name: avatar_key" on every fresh DB.
-- The ALTER has been removed; only the role rename remains.
-- ================================================================

UPDATE users SET role = 'user' WHERE role = 'customer';
