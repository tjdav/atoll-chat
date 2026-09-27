CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT PRIMARY KEY,
    actor_id    TEXT REFERENCES users(id),
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    metadata    TEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_actor_created
    ON audit_log(actor_id, created_at DESC)
    WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_action_created
    ON audit_log(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_created
    ON audit_log(created_at DESC);
