# Step 0 Empirical Verification Report: KT `leaf_hash` and Snapshot Signature

**Date:** 2026-10-22
**Task:** Key Transparency `leaf_hash` column/response addition and Snapshot `signature` exposure.

---

### 1. Current `key_transparency_log` Schema
Located in `server/migrations/0001_v2_schema.sql` (lines 359-373):
```sql
CREATE TABLE IF NOT EXISTS key_transparency_log (
    leaf_index           INTEGER PRIMARY KEY,
    user_id              TEXT REFERENCES users(id) ON DELETE CASCADE,
    bot_id               TEXT REFERENCES bot_accounts(id) ON DELETE CASCADE,
    username_token       TEXT,
    bot_identity_pubkey  TEXT,
    identity_pubkey      TEXT,
    command_pubkey       TEXT,
    added_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (user_id IS NOT NULL AND bot_id IS NULL)
        OR
        (user_id IS NULL AND bot_id IS NOT NULL)
    )
);
```
- **Columns:** `leaf_index` (INTEGER PRIMARY KEY), `user_id` (TEXT), `bot_id` (TEXT), `username_token` (TEXT), `bot_identity_pubkey` (TEXT), `identity_pubkey` (TEXT), `command_pubkey` (TEXT), `added_at` (DATETIME).
- **Constraints:** XOR check constraint enforcing that an entry belongs to either a user or a bot.
- **Absence Confirmation:** The `leaf_hash` column is currently absent from `key_transparency_log`.

---

### 2. Leaf Insertion Paths
- **User Leaves:** Appended during registration finish in `register_finish` (`server/src/routes/register.rs`, line 362). Inserts `user_id`, `username_token`, `identity_pubkey`.
- **Bot Leaves:** Appended via helper `append_bot_leaf` (`server/src/key_transparency/log.rs`, line 37), called from `server/src/routes/bots.rs` at line 308 (bot creation) and line 3001 (bot key rotation). Inserts `bot_id`, `bot_identity_pubkey`, `command_pubkey`, `identity_pubkey`.

---

### 3. Leaf Serialization & Hash Byte Format
Located in `server/src/key_transparency/merkle.rs`:
- `serialize_leaf(username_token: &str, identity_pubkey: &str) -> Vec<u8>`:
  Format: `I2OSP(len(username_token), 2) || username_token || I2OSP(len(identity_pubkey), 2) || identity_pubkey`.
- `serialize_bot_leaf(bot_identity_pubkey: &str, command_pubkey: &str, identity_pubkey: &str) -> Vec<u8>`:
  Format: `I2OSP(len(bot_identity_pubkey), 2) || bot_identity_pubkey || I2OSP(len(command_pubkey), 2) || command_pubkey || I2OSP(len(identity_pubkey), 2) || identity_pubkey`.
- `leaf_hash` calculation:
  User leaf: `SHA-256(0x00 || serialize_leaf(username_token, identity_pubkey))`.
  Bot leaf: `SHA-256(0x00 || serialize_bot_leaf(bot_identity_pubkey, command_pubkey, identity_pubkey))`.

---

### 4. Tree Head Construction
In `server/src/routes/key_transparency.rs` (`get_user_kt_handler` and `get_bot_kt_handler`):
`KtTreeHead` queries `key_transparency_snapshots`:
`SELECT id, tree_size, root_hash, signature, created_at FROM key_transparency_snapshots ORDER BY created_at DESC, id DESC LIMIT 1`.
If `snap_tree_size == current_tree_size`, it constructs `KtTreeHead` with `signature: sig_bytes.map(|s| URL_SAFE_NO_PAD.encode(&s))`.
`KtTreeHead` already carries `signature: Option<String>`.

---

### 5. Snapshot Schema
Located in `server/migrations/0001_v2_schema.sql` (lines 379-385):
```sql
CREATE TABLE IF NOT EXISTS key_transparency_snapshots (
    id         TEXT PRIMARY KEY,
    tree_size  INTEGER NOT NULL,
    root_hash  BLOB NOT NULL,
    signature  BLOB,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
- **Columns:** `id` (TEXT), `tree_size` (INTEGER), `root_hash` (BLOB), `signature` (BLOB), `created_at` (DATETIME).
- **Confirmation:** The `signature` column exists in `key_transparency_snapshots`.

---

### 6. `GET /kt/snapshot` Handler
In `server/src/routes/key_transparency.rs` (`get_kt_snapshot_handler`):
Current response struct `KtSnapshotResponse`:
```rust
pub struct KtSnapshotResponse {
    pub tree_size: i64,
    pub root_hash: String,
    pub created_at: DateTime<Utc>,
}
```
- **Confirmation:** `signature` field is currently omitted in `KtSnapshotResponse`.

---

### 7. `GET /kt/user/:id` and `GET /kt/bot/:id` Handlers
In `server/src/routes/key_transparency.rs`:
- `UserKtResponse`: `user_id`, `leaf_index`, `identity_pubkey`, `inclusion_proof`, `tree_head`, `auditor_signatures`.
- `BotKtResponse`: `bot_id`, `leaf_index`, `bot_identity_pubkey`, `bot_command_pubkey`, `identity_pubkey`, `inclusion_proof`, `tree_head`, `auditor_signatures`.
- **Confirmation:** `leaf_hash` is currently absent in both response structs.

---

### 8. `GET /kt/bot/:id/history` Handler
In `server/src/routes/key_transparency.rs`:
- `BotKtHistoryEntry`: `leaf_index`, `bot_identity_pubkey`, `bot_command_pubkey`, `identity_pubkey`, `added_at`.
- **Confirmation:** `leaf_hash` is currently absent per entry.

---

### 9. OpenAPI Annotations
In `docs/openapi.json`:
- `UserKtResponse`: missing `leaf_hash`.
- `BotKtResponse`: missing `leaf_hash`.
- `BotKtHistoryEntry`: missing `leaf_hash`.
- `KtSnapshotResponse`: missing `signature`.
- `KtTreeHead`: carries optional `signature` property.

---

### 10. Existing KT Tests & Batch Assignments
All located under `server/tests/` and assigned in `server/tests/batch-manifest.toml`:
- `key_transparency_log.rs` — Batch: `identity`
- `key_transparency_snapshots.rs` — Batch: `identity`
- `kt_endpoints.rs` — Batch: `identity`
- `kt_bot_endpoints.rs` — Batch: `identity`
- `end_to_end_walkthrough.rs` — Batch: `operations`

---

### 11. Test Assertions on Response Shapes
- `kt_endpoints.rs`: `test_get_user_kt_endpoint` and `test_get_kt_snapshot_endpoint` check status OK and deserializable JSON struct fields.
- `kt_bot_endpoints.rs`: `test_kt_bot_endpoints_and_command_key_consistency` asserts field presence on bot response and history entries.
- `end_to_end_walkthrough.rs`: Phase 13 checks presence of `bot_id`, `inclusion_proof`, `user_id`, `tree_size`, `root_hash`, `created_at`.
These tests will be updated/extended to assert `leaf_hash` and snapshot `signature`.

---

### 12. Migration State
Confirmed: the project uses a single baseline migration file (`server/migrations/0001_v2_schema.sql`). No data is deployed in production. `leaf_hash` column addition will be added directly into the baseline `CREATE TABLE key_transparency_log` definition.

---

### 13. Compat / Internal Consumers
Scanned `server/src/`: Only `server/src/routes/key_transparency.rs` and `server/src/openapi.rs` construct or expose `UserKtResponse`, `BotKtResponse`, `BotKtHistoryEntry`, and `KtSnapshotResponse`. No other internal handlers deserialize or consume these response structs.
