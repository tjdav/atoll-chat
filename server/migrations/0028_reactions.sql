-- V2 Amendment 18: message reactions.
--
-- A reaction is a short string (typically a Unicode emoji) attached to a
-- message by a specific user from a specific client. Reactions are
-- aggregated per message for display. Delivery is silent: no push
-- notifications, no unread count changes, no epoch advance.

CREATE TABLE reactions (
    id                 TEXT PRIMARY KEY,
    room_id            TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    message_id         TEXT NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
    sender_user_id     TEXT NOT NULL REFERENCES users(id),
    sender_client_id   TEXT NOT NULL,
    reaction           TEXT NOT NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at         DATETIME,
    UNIQUE (message_id, sender_user_id, sender_client_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message
    ON reactions(message_id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_reactions_room
    ON reactions(room_id, created_at DESC);
