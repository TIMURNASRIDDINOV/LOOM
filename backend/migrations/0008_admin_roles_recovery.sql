-- 0008: Admin team roles (RBAC) + Telegram password recovery intent
-- Adds a role to admin accounts (owner | manager | staff) and a purpose
-- to auth_sessions so the existing Telegram-verify flow can also drive
-- a "forgot password" recovery (purpose = 'reset') without a login.

-- Admin RBAC -----------------------------------------------------------------
ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'staff';
-- Existing admin account(s) keep full power they already had.
UPDATE admins SET role = 'owner';

-- Telegram recovery ----------------------------------------------------------
ALTER TABLE auth_sessions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login';
