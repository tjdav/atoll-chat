CREATE TABLE oprf_audit (
    id          TEXT PRIMARY KEY,
    event       TEXT NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_oprf_audit_created ON oprf_audit(created_at DESC);
