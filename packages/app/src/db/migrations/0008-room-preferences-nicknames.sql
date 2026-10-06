CREATE TABLE IF NOT EXISTS room_preferences (
  user_id     TEXT NOT NULL,
  room_id     TEXT NOT NULL,
  key         TEXT NOT NULL,
  value_json  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, room_id, key)
);

CREATE INDEX IF NOT EXISTS idx_room_preferences_room ON room_preferences(user_id, room_id);

CREATE TABLE IF NOT EXISTS nicknames (
  room_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  nickname    TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_nicknames_user ON nicknames(user_id);
