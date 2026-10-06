CREATE TABLE IF NOT EXISTS rooms (
  room_id            TEXT PRIMARY KEY,
  name               TEXT,
  avatar_file_id     TEXT,
  description        TEXT,
  disappearing_timer INTEGER,
  metadata_version   INTEGER NOT NULL DEFAULT 1,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_updated_at ON rooms(updated_at);

CREATE TABLE IF NOT EXISTS room_members (
  room_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL,
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

CREATE TABLE IF NOT EXISTS room_order (
  room_id     TEXT PRIMARY KEY,
  position    INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_order_position ON room_order(position);
