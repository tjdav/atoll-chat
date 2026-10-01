-- V2 Amendment 13: OPRF-based identity.
--
-- Removes plaintext username, username_hash, and display_name.
-- Adds username_token and encrypted_display.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
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

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

CREATE UNIQUE INDEX idx_users_username_token ON users(username_token);

PRAGMA foreign_keys = ON;
