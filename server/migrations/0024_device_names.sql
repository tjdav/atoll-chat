-- V2 Amendment 15: device names as user-scoped sync state.
--
-- Device names are encrypted client-side with a key derived from the
-- user's OPRF token. The server stores the ciphertext verbatim and never
-- decrypts it. Names are synced across the user's devices via user_seq.

ALTER TABLE devices DROP COLUMN name;

CREATE TABLE device_names (
    user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id             TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    encrypted_device_name TEXT NOT NULL,
    user_seq              INTEGER NOT NULL,
    updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at            DATETIME,
    PRIMARY KEY (user_id, device_id)
);

CREATE INDEX idx_device_names_seq ON device_names(user_id, user_seq);
