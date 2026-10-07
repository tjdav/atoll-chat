# Empirical Verification Report: Key Transparency with Bot Keys

## 1. Current `key_transparency_log` Table
From `server/migrations/0001_v2_schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS key_transparency_log (
    leaf_index      INTEGER PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username_token  TEXT NOT NULL,
    identity_pubkey TEXT NOT NULL,
    added_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kt_user ON key_transparency_log(user_id);
CREATE INDEX IF NOT EXISTS idx_kt_added ON key_transparency_log(added_at);
```
**Comparison against §7.11:**
- Current schema lacks `bot_id`, `command_pubkey`, and the `CHECK ((user_id IS NOT NULL AND bot_id IS NULL) OR (user_id IS NULL AND bot_id IS NOT NULL))` XOR constraint.
- `user_id`, `username_token`, and `identity_pubkey` are currently marked `NOT NULL`. Per §7.11, `user_id`, `bot_id`, `username_token`, `identity_pubkey`, and `command_pubkey` must be nullable to support both user leaves and bot leaves.

## 2. Current `key_transparency_snapshots` Table
From `server/migrations/0001_v2_schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS key_transparency_snapshots (
    id         TEXT PRIMARY KEY,
    tree_size  INTEGER NOT NULL,
    root_hash  BLOB NOT NULL,
    signature  BLOB,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
**Comparison against §7.11:**
- Table structure matches §7.11 exactly.

## 3. Current `room_messages.bot_key_leaf_index` Column
From `server/migrations/0001_v2_schema.sql`:
- `bot_key_leaf_index` is present in `room_messages`.
- Type: `INTEGER`, nullable.
- Code path check: In `server/src/routes/room_messages.rs`, `bot_key_leaf_index` is serialized in `RoomMessageView` as `serde_json::Value::Null` for user messages. No code path currently populates or writes a non-null value (Phase 27 wires it).

## 4. Current Leaf Serialization and Hashing
From `server/src/key_transparency/merkle.rs`:
```rust
pub fn serialize_leaf(username_token: &str, identity_pubkey: &str) -> Vec<u8> {
    let u_bytes = username_token.as_bytes();
    let i_bytes = identity_pubkey.as_bytes();
    let u_len = u_bytes.len() as u16;
    let i_len = i_bytes.len() as u16;

    let mut out = Vec::with_capacity(4 + u_bytes.len() + i_bytes.len());
    out.extend_from_slice(&u_len.to_be_bytes());
    out.extend_from_slice(u_bytes);
    out.extend_from_slice(&i_len.to_be_bytes());
    out.extend_from_slice(i_bytes);
    out
}

pub fn leaf_hash(username_token: &str, identity_pubkey: &str) -> [u8; 32] {
    let leaf_bytes = serialize_leaf(username_token, identity_pubkey);
    let mut hasher = Sha256::new();
    hasher.update([0x00]);
    hasher.update(&leaf_bytes);
    hasher.finalize().into()
}
```
- Formula matches V2 Task 34b: `I2OSP(len(username_token), 2) || username_token || I2OSP(len(identity_pubkey), 2) || identity_pubkey` with `SHA-256(0x00 || leaf_bytes)`.
- Currently, the codebase does not support a variant for bot leaves.
- **Specification Amendment Proposal:**
  V3 Spec §7.11 defines the `key_transparency_log` schema with `bot_id` and `command_pubkey`, but does not explicitly detail the byte serialization for bot leaves. Applying the precedent of user leaf serialization (Task 34b) by analogy, we propose the following bot leaf serialization amendment:
  ```
  serialize_bot_leaf(bot_identity_pubkey: &str, command_pubkey: &str, identity_pubkey: &str) -> Vec<u8>
      = I2OSP(len(bot_identity_pubkey), 2) || bot_identity_pubkey
      || I2OSP(len(command_pubkey), 2) || command_pubkey
      || I2OSP(len(identity_pubkey), 2) || identity_pubkey
  ```
  where lengths are 16-bit big-endian unsigned integers and field bytes are the UTF-8 bytes of the base64url strings (consistent with user leaf `username_token` and `identity_pubkey` text field serialization).

## 5. Current Signing Key Derivation
From `server/src/key_transparency/signing.rs`:
```rust
let serialized_bytes = setup.serialize();
let root_secret = Sha256::digest(serialized_bytes);
let hk = Hkdf::<Sha256>::new(None, &root_secret);
let mut seed = [0u8; 32];
hk.expand(b"key-transparency-signing-v1", &mut seed)?;
```
- Confirmed formula: `root_secret = SHA-256(oprf_key_bytes)`, `kt_signing_seed = HKDF-Expand(root_secret, info="key-transparency-signing-v1", length=32)`.

## 6. Current Snapshot Signing
From `server/src/key_transparency/snapshot.rs`:
```rust
pub fn format_signing_input(tree_size: u64, root_hash: &[u8; 32]) -> [u8; 40] {
    let mut input = [0u8; 40];
    input[..8].copy_from_slice(&tree_size.to_be_bytes());
    input[8..].copy_from_slice(root_hash);
    input
}
```
- Confirmed input format: `I2OSP(tree_size, 8) || root_hash` (40 bytes), signed via Ed25519 `signing_key`.

## 7. Current Insertion Point
From `server/src/routes/register.rs`:
- During `POST /auth/register/finish`, `key_transparency_log` leaf insert executes inside the same SQLite transaction as `users` insert when `state.config.key_transparency_enabled` is true.

## 8. Current Anonymization
From `server/src/gdpr.rs` (`anonymise_user`):
```rust
sqlx::query("UPDATE key_transparency_log SET user_id = ? WHERE user_id = ?")
    .bind(format!("anon_{}", hex::encode(rand::random::<[u8; 16]>())))
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
```
- Confirmed: `user_id` is replaced with `anon_<32 hex>`. `username_token` and `identity_pubkey` are retained for audit.

## 9. Current Endpoints
Existing KT endpoints:
- `GET /api/v1/admin/key-transparency`
- `POST /api/v1/admin/key-transparency/snapshot`

Missing endpoints per §8.11 and amendment:
- `GET /api/v1/kt/user/:id`
- `GET /api/v1/kt/bot/:id`
- `GET /api/v1/kt/bot/:id/history`
- `GET /api/v1/kt/snapshot`

## 10. Current `kt.snapshot` Event
From `server/src/key_transparency/snapshot.rs`:
- Published per non-deleted user on `private-user-{user_id}` with payload:
  `{ "tree_size": tree_size, "root_hash": "<base64url>", "created_at": created_at }`.
- Non-durable: does not write sync state / `user_seq` for the event payload itself, but allocates `user_seq` for envelope consistency.

## 11. Current `GET /kt/snapshot`
- Absent in current codebase.

## 12. Current Admin KT Endpoint
From `server/src/routes/admin.rs`:
- `GET /admin/key-transparency`: returns `{ enabled, total_entries, current_tree_size, latest_snapshot }`.
- `POST /admin/key-transparency/snapshot`: invokes `create_snapshot` and returns `SnapshotView`.

## 13. Current CLI Subcommand
From `server/src/cli.rs`:
- `server kt snapshot`: calls `create_snapshot`.
- `server kt verify --from <index>`: queries `key_transparency_log` for leaves where `leaf_index >= index`, computes Merkle root, fetches latest snapshot, verifies Ed25519 signature over `I2OSP(tree_size, 8) || root_hash`, and asserts Merkle root equality.

## 14. Current `bot_accounts` Schema
From `server/migrations/0001_v2_schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS bot_accounts (
    id                  TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    avatar_file_id      TEXT,
    owner_user_id       TEXT NOT NULL REFERENCES users(id),
    disabled_at         DATETIME,
    deleted_at          DATETIME
);
```
- Lacks `bot_identity_pubkey`, `bot_command_pubkey`, and `identity_pubkey`.
- This task will update `0001_v2_schema.sql` baseline to include these three pubkey columns on `bot_accounts` as nullable columns (or NOT NULL if defaulted, nullable to allow clean Phase 27 population).

## 15. Existing Tests
In `server/tests/`:
- `key_transparency_log.rs`
- `key_transparency_snapshots.rs`
Both files are assigned to the `identity` batch in `server/tests/batch-manifest.toml`.

## 16. V2 Remnants
- `key_transparency_log` schema assumes `user_id` is NOT NULL and lacks bot columns.
- `LogLeaf` struct and `compute_root` in `merkle.rs` assume leaves only have `username_token` and `identity_pubkey`.
- `create_snapshot` and CLI `server kt verify` assume user-only leaves.
