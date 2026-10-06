CREATE TABLE IF NOT EXISTS users (
  user_id         TEXT PRIMARY KEY,
  display_name    TEXT,
  identity_pubkey TEXT,
  profile_version INTEGER NOT NULL DEFAULT 1,
  cached_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_cached_at ON users(cached_at);
