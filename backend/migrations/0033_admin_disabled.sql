-- 0033 — Removing an admin who has history (status changes, approvals,
-- reviews, Instagram posts, payment checks, messages) disables the account
-- instead of deleting the row, so that history keeps its author.
-- A disabled admin cannot sign in, their sessions are rejected, and they are
-- left out of the team list. NULL = active. Additive: the Worker before this
-- ticket ignores the column. The founder applies it remotely.
ALTER TABLE admins ADD COLUMN disabled_at INTEGER;
