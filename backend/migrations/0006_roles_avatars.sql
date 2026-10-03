-- Add avatar support and fix role values
-- ALTER TABLE users ADD COLUMN avatar_key TEXT;  -- already added by 0004; kept commented so a fresh DB applies cleanly
UPDATE users SET role = 'user' WHERE role = 'customer';
