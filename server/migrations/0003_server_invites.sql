CREATE TABLE IF NOT EXISTS server_invites (
    id           TEXT PRIMARY KEY,
    code         TEXT NOT NULL UNIQUE,
    created_by   TEXT REFERENCES users(id),
    max_uses     INTEGER NOT NULL,
    current_uses INTEGER NOT NULL DEFAULT 0,
    expires_at   DATETIME,
    revoked_at   DATETIME,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_server_invites_code ON server_invites(code)
    WHERE revoked_at IS NULL;
