-- V2 Amendment 15: user preferences.
--
-- Per-user key/value store for preferences (room_order, theme, etc.).
-- Composite primary key (user_id, key) with user_seq for ordering in sync.

CREATE TABLE user_preferences (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    value_json  TEXT NOT NULL,
    user_seq    INTEGER NOT NULL,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, key)
);

CREATE INDEX idx_user_preferences_seq ON user_preferences(user_id, user_seq);
