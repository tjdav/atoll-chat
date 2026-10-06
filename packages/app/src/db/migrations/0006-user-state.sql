CREATE TABLE IF NOT EXISTS read_state (
  user_id               TEXT NOT NULL,
  room_id               TEXT NOT NULL,
  last_read_message_id  TEXT,
  last_read_at          INTEGER,
  marked_unread         INTEGER NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL,
  PRIMARY KEY (user_id, room_id)
);

CREATE INDEX IF NOT EXISTS idx_read_state_room ON read_state(room_id);

CREATE TABLE IF NOT EXISTS drafts (
  room_id     TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocked_users (
  user_id     TEXT PRIMARY KEY,
  blocked_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked_at ON blocked_users(blocked_at);
