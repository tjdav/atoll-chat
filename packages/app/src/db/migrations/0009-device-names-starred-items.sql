CREATE TABLE IF NOT EXISTS device_names (
  user_id               TEXT NOT NULL,
  device_id             TEXT NOT NULL,
  encrypted_device_name TEXT NOT NULL,
  user_seq              INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  deleted_at            INTEGER,
  PRIMARY KEY (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_names_seq ON device_names(user_id, user_seq);

CREATE TABLE IF NOT EXISTS starred_items (
  user_id     TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  item_type   TEXT NOT NULL,
  room_id     TEXT NOT NULL,
  user_seq    INTEGER NOT NULL,
  starred_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (user_id, item_id, item_type)
);

CREATE INDEX IF NOT EXISTS idx_starred_items_seq ON starred_items(user_id, user_seq);
CREATE INDEX IF NOT EXISTS idx_starred_items_room ON starred_items(user_id, room_id, starred_at DESC);
