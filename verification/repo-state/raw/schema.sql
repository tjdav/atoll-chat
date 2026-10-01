=== users ===
CREATE TABLE IF NOT EXISTS "users" (
    id                      TEXT PRIMARY KEY,
    username_token          TEXT NOT NULL UNIQUE,
    encrypted_display       TEXT,
    opaque_registration     BLOB NOT NULL,
    identity_pubkey         TEXT NOT NULL,
    profile                 TEXT,
    profile_version         INTEGER NOT NULL DEFAULT 1,
    max_file_size_bytes     INTEGER,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disabled_at             DATETIME,
    deleted_at              DATETIME,
    requires_reregistration INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_users_username_token ON users(username_token);
=== user_seq ===
CREATE TABLE user_seq (
    user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    next_seq    INTEGER NOT NULL DEFAULT 1
);
=== read_state ===
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
=== user_preferences ===
CREATE TABLE user_preferences (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    value_json  TEXT NOT NULL,
    user_seq    INTEGER NOT NULL,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, key)
);
CREATE INDEX idx_user_preferences_seq ON user_preferences(user_id, user_seq);
=== device_names ===
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
=== starred_items ===
=== rooms ===
CREATE TABLE rooms (
    id                   TEXT PRIMARY KEY,
    owner_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name_encrypted       TEXT,
    retention_days       INTEGER,
    max_file_size_bytes  INTEGER,
    moderation_override  TEXT,
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_rooms_owner
    ON rooms(owner_id);
=== room_members ===
CREATE TABLE room_members (
    room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member',
    joined_via  TEXT,
    joined_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_room_members_user
    ON room_members(user_id, joined_at DESC);
CREATE INDEX idx_room_members_room_role
    ON room_members(room_id, role);
=== room_epochs ===
CREATE TABLE room_epochs (
    room_id    TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    epoch      INTEGER NOT NULL DEFAULT 0,
    sequence   INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, confirmed_transcript_hash BLOB, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
=== room_messages ===
CREATE TABLE room_messages (
    id                        TEXT PRIMARY KEY,
    room_id                   TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sender_user_id            TEXT NOT NULL REFERENCES users(id),
    sender_client_id          TEXT NOT NULL,
    epoch                     INTEGER NOT NULL,
    seq                       INTEGER NOT NULL,
    content_type              TEXT NOT NULL CHECK(content_type IN ('application', 'commit', 'proposal')),
    ciphertext                BLOB NOT NULL,
    created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, deleted_at DATETIME);
CREATE INDEX idx_room_messages_room_epoch_seq
    ON room_messages(room_id, epoch, seq);
CREATE INDEX idx_room_messages_room_created
    ON room_messages(room_id, created_at DESC);
CREATE INDEX idx_room_messages_sender
    ON room_messages(sender_user_id, created_at DESC);
CREATE INDEX idx_room_messages_room_deleted
    ON room_messages(room_id, deleted_at)
    WHERE deleted_at IS NOT NULL;
=== reactions ===
=== key_packages ===
CREATE TABLE key_packages (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id   TEXT NOT NULL,
    key_package_data BLOB NOT NULL,
    consumed    INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
, cipher_suite INTEGER NOT NULL DEFAULT 1, is_last_resort INTEGER NOT NULL DEFAULT 0, consumed_at DATETIME);
CREATE INDEX idx_kp_claim_order
    ON key_packages(user_id, consumed, is_last_resort, created_at ASC, id ASC)
    WHERE consumed = 0;
=== welcomes ===
CREATE TABLE welcomes (
    id                  TEXT PRIMARY KEY,
    room_id             TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    recipient_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_client_id TEXT NOT NULL,
    welcome_data        BLOB NOT NULL,
    consumed            INTEGER NOT NULL DEFAULT 0,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_welcomes_recipient
    ON welcomes(recipient_user_id, consumed, created_at DESC);
=== pending_mls_removes ===
CREATE TABLE pending_mls_removes (
    id               TEXT PRIMARY KEY,
    room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    target_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_client_id TEXT NOT NULL,
    queued_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consumed_at      DATETIME
);
CREATE INDEX idx_pending_mls_removes_active
    ON pending_mls_removes(room_id, consumed_at)
    WHERE consumed_at IS NULL;
CREATE INDEX idx_pending_mls_removes_pending
    ON pending_mls_removes(room_id, queued_at ASC)
    WHERE consumed_at IS NULL;
=== pending_mls_adds ===
=== attachments ===
CREATE TABLE attachments (
    id                 TEXT PRIMARY KEY,
    room_id            TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    uploader_id        TEXT NOT NULL REFERENCES users(id),
    uploader_client_id TEXT,
    storage_backend    TEXT NOT NULL CHECK(storage_backend IN ('fs', 's3')),
    storage_key        TEXT NOT NULL,
    padded_size        INTEGER NOT NULL,
    plaintext_size     INTEGER NOT NULL,
    encrypted_size     INTEGER NOT NULL,
    chunk_size         INTEGER NOT NULL,
    chunk_count        INTEGER NOT NULL,
    nonce_prefix       TEXT NOT NULL,
    base_counter       INTEGER NOT NULL,
    content_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_attachments_room_created
    ON attachments(room_id, created_at DESC);
CREATE INDEX idx_attachments_uploader_created
    ON attachments(uploader_id, created_at DESC);
CREATE INDEX idx_attachments_created
    ON attachments(created_at);
=== push_subscriptions ===
CREATE TABLE push_subscriptions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id    TEXT REFERENCES devices(id) ON DELETE CASCADE,
    platform     TEXT NOT NULL,
    endpoint     TEXT,
    p256dh       TEXT,
    auth         TEXT,
    push_token   TEXT,
    browser_id   TEXT,
    user_agent   TEXT,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME,
    revoked_at   DATETIME
);
=== recovery_codes ===
=== key_transparency_log ===
=== key_transparency_snapshots ===
=== call_sessions ===
=== call_participants ===
=== hangouts ===
=== instance_config ===
CREATE TABLE instance_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT REFERENCES users(id)
);
=== instance_limits ===
CREATE TABLE instance_limits (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT REFERENCES users(id)
);
=== audit_log ===
CREATE TABLE audit_log (
    id          TEXT PRIMARY KEY,
    actor_id    TEXT REFERENCES users(id),
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    metadata    TEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_actor_created
    ON audit_log(actor_id, created_at DESC)
    WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_action_created
    ON audit_log(action, created_at DESC);
CREATE INDEX idx_audit_created
    ON audit_log(created_at DESC);
=== backups ===
=== rate_limits ===
CREATE TABLE rate_limits (
    key          TEXT NOT NULL,
    window_start DATETIME NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key, window_start)
);
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);
=== oprf_audit ===
CREATE TABLE oprf_audit (
    id          TEXT PRIMARY KEY,
    event       TEXT NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_oprf_audit_created ON oprf_audit(created_at DESC);
