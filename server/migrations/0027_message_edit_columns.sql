-- V2 Amendment 17: message edit chain.
--
-- An edit is a new room_messages row with edit_of = <original id> and
-- edit_sequence = <previous + 1>. The original row remains. The chain is
-- reconstructed by querying edit_of = <original id> ORDER BY edit_sequence.
--
-- edited_at is set on the original row on the first edit.

ALTER TABLE room_messages ADD COLUMN edit_of TEXT REFERENCES room_messages(id);
ALTER TABLE room_messages ADD COLUMN edit_sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_messages ADD COLUMN edited_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_room_messages_edit_of
    ON room_messages(edit_of)
    WHERE edit_of IS NOT NULL;
