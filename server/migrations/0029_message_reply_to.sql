ALTER TABLE room_messages ADD COLUMN reply_to TEXT REFERENCES room_messages(id);

CREATE INDEX IF NOT EXISTS idx_room_messages_reply_to ON room_messages(reply_to)
    WHERE reply_to IS NOT NULL;
