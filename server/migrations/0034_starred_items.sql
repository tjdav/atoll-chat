CREATE TABLE IF NOT EXISTS starred_items (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     TEXT NOT NULL,
    item_type   TEXT NOT NULL,
    room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_seq    INTEGER NOT NULL,
    starred_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at  DATETIME,
    PRIMARY KEY (user_id, item_id, item_type)
);

CREATE INDEX IF NOT EXISTS idx_starred_items_seq ON starred_items(user_id, user_seq);
CREATE INDEX IF NOT EXISTS idx_starred_items_room ON starred_items(user_id, room_id, starred_at DESC);
