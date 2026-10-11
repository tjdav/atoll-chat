# Key Transparency Bot Leaf Step 0 Empirical Report

## 1. Current `key_transparency_log` table

```sql
CREATE TABLE IF NOT EXISTS key_transparency_log (
    leaf_index       INTEGER PRIMARY KEY,
    user_id          TEXT REFERENCES users(id) ON DELETE CASCADE,
    bot_id           TEXT REFERENCES bot_accounts(id) ON DELETE CASCADE,
    username_token   TEXT,
    identity_pubkey  TEXT,
    command_pubkey   TEXT,
    added_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (user_id IS NOT NULL AND bot_id IS NULL)
        OR
        (user_id IS NULL AND bot_id IS NOT NULL)
    )
);
```

- Confirmed absence of `bot_identity_pubkey` column in current baseline schema.
- Confirmed XOR `CHECK` constraint enforcing either `user_id` is set (with `bot_id IS NULL`) or `bot_id` is set (with `user_id IS NULL`).

## 2. Current `key_transparency_snapshots` table

```sql
CREATE TABLE IF NOT EXISTS key_transparency_snapshots (
    id         TEXT PRIMARY KEY,
    tree_size  INTEGER NOT NULL,
    root_hash  BLOB NOT NULL,
    signature  BLOB,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- Confirmed matches V3 Spec §7.11.

## 3. Current Leaf Serialization Code

In `server/src/key_transparency/merkle.rs`:

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

- Confirmed format: `I2OSP(len(username_token), 2) || username_token || I2OSP(len(identity_pubkey), 2) || identity_pubkey`.
- Confirmed leaf hash: `SHA-256(0x00 || leaf_bytes)`. Matches V2 Task 34b facts.

## 4. Current Tree Construction Code

In `server/src/key_transparency/merkle.rs`:

```rust
pub fn node_hash(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update([0x01]);
    hasher.update(left);
    hasher.update(right);
    hasher.finalize().into()
}

pub fn largest_power_of_two_less_than(n: usize) -> usize {
    debug_assert!(n > 1);
    1 << (usize::BITS - 1 - (n - 1).leading_zeros())
}
```

- Internal node hash is `SHA-256(0x01 || left_hash || right_hash)`.
- RFC 6962 split rule `k = 1 << (31 - (N - 1).leading_zeros())` implemented via `largest_power_of_two_less_than(n)`. Matches V2 Task 34b facts.

## 5. Current Signing Derivation

In `server/src/key_transparency/signing.rs`:

```rust
let serialized_bytes = setup.serialize();
let root_secret = Sha256::digest(serialized_bytes);

let hk = Hkdf::<Sha256>::new(None, &root_secret);
let mut seed = [0u8; 32];
hk.expand(b"key-transparency-signing-v1", &mut seed)
    .map_err(|e| SigningKeyError::KeyConstruction(e.to_string()))?;

let signing_key = SigningKey::from_bytes(&seed);
```

- Confirmed `root_secret = SHA-256(oprf_key_bytes)`.
- Confirmed `kt_signing_seed = HKDF-Expand(root_secret, info="key-transparency-signing-v1", length=32)`.

## 6. Current `GET /kt/user/:id` Handler

In `server/src/routes/key_transparency.rs`:

- Path: `GET /api/v1/kt/user/:id`.
- Auth: `AuthUser` required (returns 401 without token).
- Response shape (`UserKtResponse`):
  ```json
  {
    "user_id": "u_...",
    "leaf_index": 1234,
    "identity_pubkey": "<base64url>",
    "inclusion_proof": ["<base64url>", ...],
    "tree_head": { "id": "...", "tree_size": N, "root_hash": "...", "signature": "...", "created_at": "..." },
    "auditor_signatures": []
  }
  ```
- Confirmed response omits `username_token`.

## 7. Current `GET /kt/snapshot` Handler

In `server/src/routes/key_transparency.rs`:

- Path: `GET /api/v1/kt/snapshot`.
- Auth: `AuthUser` required.
- Response shape (`KtSnapshotResponse`):
  ```json
  {
    "tree_size": N,
    "root_hash": "<base64url>",
    "created_at": "..."
  }
  ```
- Confirmed no `signature` field in response shape.

## 8. Current KT Leaf Insertion Point for Users

In `server/src/routes/register.rs` (`register_finish_handler`, line 296):

```rust
let leaf_index: i64 = sqlx::query_scalar(
    r#"
    INSERT INTO key_transparency_log (user_id, username_token, identity_pubkey)
    VALUES (?, ?, ?)
    RETURNING leaf_index
    "#,
)
.bind(&user_id)
.bind(&req.username_token)
.bind(&req.identity_pubkey)
.fetch_one(&mut *tx)
.await?;
```

- Confirmed inside the enclosing registration transaction `tx` alongside `users` insert.

## 9. Current `POST /bots` Handler

In `server/src/routes/bots.rs` (`create_bot`):

- Inserts into `bot_accounts`, `bot_declared_scopes`, and `bot_tokens`.
- Confirmed it does **not** append a KT leaf to `key_transparency_log`.
- Stores three pubkeys on `bot_accounts`: `bot_identity_pubkey`, `bot_command_pubkey`, `identity_pubkey`.

## 10. Current `bot_accounts` Schema

In `server/migrations/0001_v2_schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS bot_accounts (
    id                  TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    avatar_file_id      TEXT REFERENCES attachments(id) ON DELETE SET NULL,
    bot_identity_pubkey TEXT NOT NULL,
    bot_command_pubkey  TEXT NOT NULL,
    identity_pubkey     TEXT NOT NULL,
    owner_user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    declarations        TEXT,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at          DATETIME
);
```

- Confirmed all three pubkey columns are `NOT NULL` and populated at bot creation time.

## 11. Current KT Log Write Path

- Leaf indices use SQLite AUTOINCREMENT / `INTEGER PRIMARY KEY` allocation (`RETURNING leaf_index`).
- Execution occurs within caller's SQL transaction (`&mut sqlx::SqliteConnection` or `&mut *tx`).

## 12. Current User-Channel `kt.snapshot` Publisher

In `server/src/key_transparency/snapshot.rs`:

- `create_snapshot` queries `users WHERE deleted_at IS NULL`.
- Allocates `user_seq` in per-user transactions and publishes non-durable `kt.snapshot` event via `Publisher::publish` on `private-user-{user_id}`.
- Confirmed non-durable and unchanged.

## 13. Existing Tests

- `server/tests/key_transparency_log.rs`
- `server/tests/key_transparency_snapshots.rs`
- `server/tests/kt_endpoints.rs`

All registered under the `identity` batch in `server/Makefile` and `server/tests/batch-manifest.toml`.

## 14. V2 Remnants

- In `server/src/routes/key_transparency.rs`, `get_user_kt_handler` contained temporary placeholder hashing logic for bot leaves (`serialize_leaf(b_pub, c_pub)`) that lacked `bot_identity_pubkey`.
- In `server/src/key_transparency/snapshot.rs` (`create_snapshot`), `SELECT username_token, identity_pubkey FROM key_transparency_log` assumed leaves only contain `username_token` and `identity_pubkey`.
- In `server/src/cli.rs`, `verify_kt_log` queried `username_token, identity_pubkey` from `key_transparency_log`.
- Confirmed neither user endpoint nor snapshot endpoint exposes `username_token` in API responses.
