-- ================================================================
-- LOOM Backend — Phone/Telegram Auth, User Sessions, Activity Log
-- Apply: wrangler d1 execute loom-db --local --file migrations/0003_phone_auth.sql
--        wrangler d1 execute loom-db --file migrations/0003_phone_auth.sql
-- ================================================================

-- ─── Extend existing users table ─────────────────────────────────────────────
-- SQLite only supports ADD COLUMN. Existing rows get NULL / DEFAULT values.

ALTER TABLE users ADD COLUMN telegram_user_id INTEGER;
ALTER TABLE users ADD COLUMN telegram_username TEXT;
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN last_login_at INTEGER;

-- Partial unique index on phone (NULL values don't collide)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique    ON users(phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tg_user_unique  ON users(telegram_user_id) WHERE telegram_user_id IS NOT NULL;

-- ─── Auth sessions (Telegram verification flow) ───────────────────────────────

CREATE TABLE IF NOT EXISTS auth_sessions (
  id               TEXT    PRIMARY KEY,   -- random UUID token (the session_id)
  phone            TEXT    NOT NULL,      -- E.164 format entered by user
  status           TEXT    NOT NULL DEFAULT 'pending', -- pending|verified|failed|expired
  jwt              TEXT,                  -- issued JWT, populated on verified
  user_id          INTEGER,               -- FK → users.id, populated on verified
  telegram_user_id INTEGER,               -- set when /start command is received
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_status   ON auth_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_telegram ON auth_sessions(telegram_user_id);

-- ─── User sessions (cookie-based, longer lived) ───────────────────────────────

CREATE TABLE IF NOT EXISTS user_sessions (
  id          TEXT    PRIMARY KEY,        -- session token used as cookie
  user_id     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT,
  ip          TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, expires_at);

-- ─── User activity log ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  action      TEXT    NOT NULL,           -- login|order_placed|banned|unbanned|role_changed|notified
  metadata    TEXT,                       -- JSON blob
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity_log(user_id, created_at DESC);

-- ─── Notifications sent ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications_sent (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL,
  message             TEXT    NOT NULL,
  button_label        TEXT,
  button_url          TEXT,
  telegram_message_id INTEGER,
  sent_at             INTEGER NOT NULL,
  sent_by_admin_id    INTEGER,            -- FK → admins.id
  status              TEXT    NOT NULL DEFAULT 'sent',  -- sent|failed
  error_detail        TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications_sent(user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_notifications_time ON notifications_sent(sent_at DESC);

-- ─── Link existing orders table to phone-auth users ───────────────────────────
-- orders.user_id already exists and references the same users.id (INTEGER PK).
-- No additional column needed.
