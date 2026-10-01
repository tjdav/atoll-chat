-- V2 Amendment 15: read state.
--
-- For each (user, room) pair, the ID of the last message the user has read.
-- The user_seq column orders writes within the user's sync stream.
-- deleted_at supports tombstoning when a user leaves a room or marks state
-- as removed.

CREATE TABLE read_state (
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id              TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    last_read_message_id TEXT,
    user_seq             INTEGER NOT NULL,
    updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at           DATETIME,
    PRIMARY KEY (user_id, room_id)
);

CREATE INDEX idx_read_state_seq ON read_state(user_id, user_seq);
