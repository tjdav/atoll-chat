-- Amendment 2 (2026-09-28): Message Deletion Endpoint
--
-- Adds a tombstone column to room_messages. Phase 10 does not read or
-- write this column. Phase 11's DELETE /rooms/:id/messages/:msg_id
-- endpoint sets it. Deleted messages remain in the table until retention
-- pruning removes them. See spec §8.5.2.

ALTER TABLE room_messages ADD COLUMN deleted_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_room_messages_room_deleted
    ON room_messages(room_id, deleted_at)
    WHERE deleted_at IS NOT NULL;
