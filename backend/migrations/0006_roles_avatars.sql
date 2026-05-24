-- Add avatar support and fix role values
ALTER TABLE users ADD COLUMN avatar_key TEXT;
UPDATE users SET role = 'user' WHERE role = 'customer';
