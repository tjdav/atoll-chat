# Server Specification v2.0 Excerpts for Key Transparency

## Section 2.1 — Scope (Key Transparency Bullet)
> - Key transparency. Append-only log with inclusion proofs and auditor signatures.

## Section 5.22 — Key Transparency Environment Variables
```
KEY_TRANSPARENCY_ENABLED=true
KEY_TRANSPARENCY_LOG_PATH=/data/kt-log
KEY_TRANSPARENCY_AUDITOR_KEYS=
```

## Section 7.10 — Key Transparency and Ops Schema
```sql
CREATE TABLE key_transparency_log (
    leaf_index      INTEGER PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username_token  TEXT NOT NULL,
    identity_pubkey TEXT NOT NULL,
    added_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kt_user ON key_transparency_log(user_id);
CREATE INDEX idx_kt_added ON key_transparency_log(added_at);

CREATE TABLE key_transparency_snapshots (
    id           TEXT PRIMARY KEY,
    tree_size    INTEGER NOT NULL,
    root_hash    BLOB NOT NULL,
    signature    BLOB,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## Section 8.3 — Admin Endpoints
```
8.3 Admin

Unchanged from V1 §8.3, plus:

Method — Path — Purpose
POST — /admin/oprf/rotate — Rotate the username OPRF key (catastrophic)
GET — /admin/key-transparency — Read KT log stats
POST — /admin/key-transparency/snapshot — Trigger a signed snapshot
GET — /admin/rooms/:id/hangouts — Read-only list of hangouts (metadata only, no occupancy)
POST — /admin/models/reload — Reload the model manifest
```

## Section 8.8 — Event Catalog
```
Room events (private-room-{room_id}):
...
kt.snapshot
```

## Section 14.8 — Audit Actions
```
14.8 Audit Actions

V1 actions plus:
...
- kt.snapshot
```

## Section 16.7 — Amendment 19
```
16.7 Amendment 19 — Key Transparency — 2026-09-29

Added key_transparency_log, key_transparency_snapshots. Added auditor signature support. Added kt.snapshot event and admin endpoints.
```
