-- Migration 0011: Room indexes and room_epochs table
CREATE TABLE IF NOT EXISTS room_epochs (
    room_id    TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    epoch      INTEGER NOT NULL DEFAULT 0,
    sequence   INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_room_members_user
    ON room_members(user_id, joined_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_members_room_role
    ON room_members(room_id, role);

CREATE INDEX IF NOT EXISTS idx_rooms_owner
    ON rooms(owner_id);
