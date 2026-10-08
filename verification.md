# Verification Log

## V-B — Key Transparency Scale Verification
- **ID:** V-B
- **Date:** 2026-10-01
- **Status:** complete
- **Spec sections affected:** §7.10, §8.3, §8.8, §16.7, §16.35
- **Question asked:** What is the required implementation scale for Key Transparency in Server Specification v2.0 relative to RFC 6962 (Full RFC 6962 vs RFC 6962-lite vs Simplified Log)?
- **Answer found:** Interpretation B (RFC 6962-lite) — implement RFC 6962 binary Merkle tree with $O(\log N)$ inclusion proofs and Ed25519-signed snapshots/STHs, while omitting web-PKI consistency proofs and multi-log gossip protocols.
- **Link to report:** [verification/key-transparency-scale/report.md](verification/key-transparency-scale/report.md)

## V-D — Repository State Verification
- **ID:** V-D
- **Date:** 2026-10-01
- **Status:** Complete. Canonical.
- **Spec sections affected:** None directly. This is a reconciliation snapshot.
- **Question asked:** What is the current ground truth of the repository across migrations, tests, schema, routes, CLI subcommands, environment variables, rate limits, capabilities, events, the task ledger, and the verification log?
- **Answer found:** Ground truth established across all repository state elements. See the report and the reconciled task ledger.
- **Link to report:** [verification/repo-state/report.md](verification/repo-state/report.md)

## MIG-FIX — Remove Redundant requires_reregistration Migration
- **ID:** MIG-FIX
- **Date:** 2026-10-02
- **Status:** Complete.
- **Spec sections affected:** §5.8
- **Question asked:** How to resolve the migration conflict where `requires_reregistration` column was added twice during fresh database migration?
- **Answer found:** Removed redundant `0025_requires_reregistration.sql` migration file. The `requires_reregistration` column is already defined in `0020_users_oprf_identity.sql`. Database migrations 0001 through 0024 now run sequentially without conflict on a clean database.

## MIG-RESET — Consolidated V2 Baseline Migration
- **ID:** MIG-RESET
- **Date:** 2026-10-04
- **Status:** Complete. Canonical.
- **Spec sections affected:** §7, §16
- **Question asked:** How to consolidate all 35 layered migration files (`0001` through `0036`, with `0025` removed) into a single baseline migration without breaking database execution or test environments?
- **Answer found:**
  - **Single Migration Baseline:** Consolidated all 35 legacy migration files into `server/migrations/0001_v2_schema.sql`. Deleted all legacy migration files (`0001_initial.sql` through `0036_room_sessions.sql`). `ls server/migrations/` returns strictly `0001_v2_schema.sql`.
  - **Developer/CI Wipe Requirement:** Pre-existing databases in developer or CI environments must be wiped (`rm data/app.db*`). Future migrations will append starting at `0002_*.sql`.
  - **Index & Column Reconciliation:** All index definitions and table constraints were reconciled to match V-G's canonical target schema §9.
  - **Role Seed Source:** Roles seed `INSERT OR IGNORE INTO roles ...` is included directly in `0001_v2_schema.sql` so that clean migrations populate standard RBAC roles (`owner`, `admin`, `inviter`, `member`).
  - **Verification:** Test `server/tests/migration_schema.rs` asserts single migration file presence, clean migration run, idempotency, foreign key enforcement, role seed integrity, and structural schema equivalence against pre-consolidation canonical snapshot.

## Task 26 — Room Metadata Encrypted Blob
- **ID:** Task 26 Room Metadata Encrypted
- **Date:** 2026-10-06
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §1.2, §3.2, §4.1, §4.4, §7.4, §8.4, §8.9, §10, §12
- **Question asked:** What is the canonical implementation for room metadata schema, limits, authorization, `metadata_version` increment rules, and `room.updated` event payload?
- **Answer found:**
  - **Schema:** `rooms` table in `server/migrations/0001_v2_schema.sql` contains `metadata` (TEXT) and `metadata_version` (INTEGER NOT NULL DEFAULT 1), matching §7.4.
  - **Limits:** Configured via `SERVER_MAX_ROOM_METADATA_BYTES` (64 KB hard max) and `ROOM_METADATA_MAX_BYTES` (16 KB instance default, range 1 KB – 64 KB).
  - **`metadata_version` Rule:** Increments by 1 on metadata modification only. No-op PATCH with unchanged metadata preserves `metadata_version` without incrementing and skips event emission.
  - **`room.updated` Event Payload:** Carries `{ room_id, metadata }` on `private-room-{room_id}` per §8.9. Best-effort delivery.
  - **Authorization:** `owner` or `moderator` (Discord mode) / `owner` (Messenger mode) per §3.2. Effective mode resolves per-room `moderation_override` falling back to instance `moderation_mode`.
  - **Response Shape:** `PATCH /rooms/:id` returns `{ room_id, metadata, metadata_version }` per §8.4 (without `updated_at`).
  - **Opacity Invariant:** The server never decrypts or inspects `metadata`. Verbatim ciphertext string roundtrip verified byte-for-byte.
- **Link to report:** [verification/room-metadata-encrypted/report.md](verification/room-metadata-encrypted/report.md)

## Task 27 — Message Editing Contract Verification
- **ID:** Task 27 Message Editing Contract
- **Date:** 2026-10-06
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec / Amendment references:** V3 Spec §1.2, §3.2, §4.2, §5.5, §7.6, §8.5, §8.5.1, §8.9, §10, §12
- **Question asked:** What are the canonical flat-chain rule, `edit_window_seconds` resolution, `PATCH /rooms/:id/messages/:msg_id` status/response shape, and `message.edited` event payload shape for message editing?
- **Answer found:**
  - **Flat-Chain Invariant:** Edits cannot chain off other edits. An edit request targeting a message with `edit_of IS NOT NULL` is rejected with HTTP 409 Conflict (`cannot_edit_edit`). All edits chain flat off the original message (`edit_of = original.id`) with `edit_sequence` incremented monotonically.
  - **Edit Window Resolution:** Enforced via three-tier model where `SERVER_MAX_EDIT_WINDOW_SECONDS` (server hard max, default 86400) clamps `EDIT_WINDOW_SECONDS` (instance default, default 900, range 60–86400). Runtime instance limits fetched via `limits::get_limits`. Reference timestamp for window comparison is the original message's `created_at`. Expiry returns HTTP 403 `edit_window_expired`.
  - **Response Status & Shape:** `PATCH /rooms/:id/messages/:msg_id` returns HTTP 201 Created with `RoomMessageView` in the exact same shape as `GET /rooms/:id/messages` (`id`, `room_id`, `sender_user_id`, `sender_client_id`, `epoch`, `seq`, `content_type`, `reply_to`, `edit_of`, `edit_sequence`, `edited_at`, `deleted_at`, `created_at`, `reactions`).
  - **`edited_at` Placement:** Set on the edit row itself (`edited_at = edit_created_at`). The original row remains unchanged (`edited_at IS NULL`).
  - **`message.edited` Event Payload:** Published on `private-room-{room_id}` strictly matching §8.9: `{ "id": "<new_edit_row_id>", "edit_of": "<original_id>", "edit_sequence": <int>, "room_id": "<room_id>", "sender_type": "user" | "bot", "sender_id": "<user_id>", "created_at": "<iso8601>" }`.
  - **Whisper Invariant:** The room channel must never receive a whisper edit.
- **Link to report:** [verification/message-editing-v3/report.md](verification/message-editing-v3/report.md)

## Task 28 — Message Reactions V3 Contract Alignment
- **ID:** Task 28
- **Date:** 2026-10-06
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §3.2, §4.2, §5.6, §7.6, §8.5, §8.9, §10, §12
- **Question asked:** What are the canonical event payloads, tombstone retention rules, idempotent add semantics, delete route path/authorization, and rate limit scope for message reactions?
- **Answer found:**
  - **Schema & Indexes:** Reuses `reactions` table in `server/migrations/0001_v2_schema.sql` with `UNIQUE (message_id, sender_user_id, sender_client_id, reaction)` and partial index `idx_reactions_message ON reactions(message_id) WHERE deleted_at IS NULL`.
  - **Add Reaction Endpoints (`POST /rooms/:id/messages/:msg_id/reactions`):**
    - Accepts `sender_client_id` (or `client_id` fallback).
    - Checks active reaction count against dynamic `reactions_per_message` limit (server hard max `SERVER_MAX_REACTIONS_PER_MESSAGE = 50`).
    - Operates on tombstoned parent messages per §7.6 (`room_messages.deleted_at` is ignored during message existence check).
    - Idempotent upsert: Active duplicate reaction returns HTTP 200 OK with existing reaction row ID; fresh addition or re-activated soft-deleted reaction clears `deleted_at`, keeps stable `id`, updates `created_at`, and returns HTTP 201 Created.
  - **Remove Reaction Endpoints (`DELETE /rooms/:id/messages/:msg_id/reactions/:reaction_id`):**
    - Route path targets reaction primary key `:reaction_id`.
    - Authorization: Reaction sender or room owner/moderator may delete reactions. Non-authorized members receive HTTP 403 `forbidden`.
    - Soft-deletes row (`deleted_at = CURRENT_TIMESTAMP`), operates on tombstoned messages, returns HTTP 204 No Content.
  - **Rate Limiting:** `RATE_REACTION_PER_MIN` (default 60/min) is strictly enforced on the `POST` add endpoint (key `reaction:{user_id}:min:{boundary}`). The `DELETE` endpoint is NOT rate-limited by this key per V3 spec.
  - **Event Payloads (§8.9):**
    - `reaction.added`: Published on `private-room-{room_id}` with `{ "id": "...", "room_id": "r_...", "message_id": "m_...", "sender_user_id": "u_...", "reaction": "...", "created_at": "..." }`.
    - `reaction.removed`: Published on `private-room-{room_id}` with `{ "id": "...", "room_id": "r_...", "message_id": "m_..." }`.
    - Both events are published for tombstoned messages; clients filter locally per §7.6.
    - Neither event is published on `private-user-{user_id}` channels.
  - **Whisper Stubs:** Phase 10 whisper routing stub comments added at both event publish sites in `server/src/routes/reactions.rs`.
- **Link to report:** [verification/reactions-v3/report.md](verification/reactions-v3/report.md)

## Task 15b-R — Push Payload `sender_ref` Wire Format
- **ID:** Task 15b-R
- **Date:** 2026-10-02
- **Status:** Complete. Canonical.
- **Spec sections affected:** §5.10, §16.12
- **Question asked:** What is the exact canonical wire format for `sender_ref` in push notification payloads?
- **Answer found:** `sender_ref` is a 22-character unpadded base64url string derived by decoding the sender's 86-character `username_token` (unpadded base64url -> 64 bytes), taking the first 16 bytes, and re-encoding as unpadded base64url. It replaces `sender_user_id` in push notification envelopes across Web Push, APNs, and FCM.

## Task 30 — Room Member Pagination Cursor Format
- **ID:** Task 30
- **Date:** 2026-10-02
- **Status:** Complete. Canonical.
- **Spec sections affected:** §2.1, §8.2
- **Question asked:** What is the exact cursor format and encoding used for `GET /rooms/:id/members` pagination?
- **Answer found:** The cursor is an opaque, unpadded base64url encoded string of a JSON struct `{"room_id": "<room_id>", "last_user_id": "<user_id>"}`. The server validates that `cursor.room_id` matches the path `:id` (returning 400 `invalid_cursor` on mismatch or malformed format). Pagination uses total stable ordering on `user_id ASC`.

## Task 22a — Recovery Code Generation & Argon2id Format
- **ID:** Task 22a
- **Date:** 2026-10-02
- **Status:** Complete. Canonical.
- **Spec sections affected:** §2.1, §4.5, §6.23, §7.1, §16.2
- **Question asked:** What are the recovery code format, salt length, Argon2id parameters, single-use policy, and migration details?
- **Answer found:**
  - **Code format:** Crockford Base32, exactly 20 characters uppercase `[0-9A-HJKMNP-TV-Z]`, providing 100 bits of entropy.
  - **Salt length:** 16 random bytes (`ARGON2_SALT_LEN = 16`).
  - **Argon2id parameters:** OWASP defaults: `m_cost = 19456` (19 MiB), `t_cost = 2`, `p_cost = 1`, output length 32 bytes (`ARGON2_HASH_LEN = 32`).
  - **Lifecycle:** Codes are single-use by default (`consumed_at` set upon use) and do not expire.
  - **Migration:** Created migration `0030_recovery_codes.sql` for table `recovery_codes` with index `idx_recovery_codes_user` on `(user_id, consumed_at) WHERE consumed_at IS NULL`.

## Task 31 — Retention Change Preview Semantics
- **ID:** Task 31
- **Date:** 2026-10-02
- **Status:** Complete. Canonical.
- **Spec sections affected:** §2.1, §3.2, §8.4
- **Question asked:** What are the exact request/response shapes, retention semantics, row filtering rules, and rate-limit policy for `POST /rooms/:id/retention/preview`?
- **Answer found:**
  - **Endpoint & Auth:** `POST /api/v1/rooms/:id/retention/preview`. Owner-only authorization (returns 403 `forbidden` for non-owner members, 404 `room_not_found` for non-members).
  - **Request Body:** `{ "retention_days": <i64> }` where `0 <= retention_days <= 365`. Values out of range or non-integer return 400 `invalid_retention_days`.
  - **Retention Semantics:** `retention_days = 0` means "forever" (no pruning -> 0 affected items).
  - **Affected Item Boundary & Selection:**
    - Comparison cutoff: `created_at < datetime('now', '-' || proposed_retention_days || ' days')`.
    - Soft-deleted messages (`deleted_at IS NOT NULL`) and commit/proposal protocol artifacts (`content_type IN ('commit', 'proposal')`) are excluded from count.
    - Edit rows (`edit_of IS NOT NULL`) are standard message rows and are included in message count.
    - Attachment count includes attachments in the room matching the same cutoff.
  - **Response Shape:**
    ```json
    {
      "current_retention_days": 90,
      "proposed_retention_days": 30,
      "messages_affected": 1234,
      "attachments_affected": 56,
      "oldest_affected_at": "2026-01-01T00:00:00Z",
      "newest_affected_at": "2026-06-01T12:34:56Z"
    }
    ```
    Returns `Cache-Control: no-store`.
  - **Rate Limit Policy:** Endpoint is read-only and cheap (single indexed scan). No new rate limit variant added.
  - **Delta (V3 Alignment):** V3 confirms the V2 Task 31 fact with one correction — `oldest_affected_at` and `newest_affected_at` timestamps are computed across the union of affected messages and room-scoped attachments (taking overall `MIN(created_at)` and `MAX(created_at)` across both tables), not messages only.

## Task — Retention Change Preview V3 Alignment (Phase 12)
- **ID:** Retention Preview V3 Alignment
- **Date:** 2026-10-06
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §3.2, §4.1, §4.2, §4.5, §7.6, §7.7, §8.4, §10
- **Question asked:** What are the canonical endpoint contracts, retention cutoff semantics, row inclusion/exclusion rules, timestamp calculation, and rate-limit policy for `POST /rooms/:id/retention/preview`?
- **Answer found:**
  - **Endpoint & Authorization:** `POST /api/v1/rooms/:id/retention/preview`. Owner-only authorization (HTTP 403 `forbidden` for non-owner members, HTTP 404 `room_not_found` for non-members, HTTP 401 `unauthorized` for unauthenticated requests).
  - **Request Body & Validation:** `{ "retention_days": <i64> }` where `0 <= retention_days <= 365`. Non-integer or out-of-range values return HTTP 400 `invalid_retention_days`.
  - **Retention Semantics:** `retention_days = 0` means "forever" (no pruning), returning `messages_affected = 0`, `attachments_affected = 0`, `oldest_affected_at = null`, `newest_affected_at = null`.
  - **Message Selection:** Cutoff `created_at < datetime('now', '-' || proposed_retention_days || ' days')`. Soft-deleted rows (`deleted_at IS NOT NULL`) and MLS protocol rows (`content_type IN ('commit', 'proposal')`) are excluded. Standard application messages (`content_type = 'application'`), bot messages (`content_type = 'bot'`), edit rows (`edit_of IS NOT NULL`), and whisper messages (`target_user_ids IS NOT NULL`) are included.
  - **Attachment Selection:** Cutoff matches same retention window. Scoped strictly to room attachments (`room_id = ?`). User-scoped attachments (`room_id IS NULL`) are excluded.
  - **Timestamp Calculation:** `oldest_affected_at` and `newest_affected_at` evaluate `MIN(created_at)` and `MAX(created_at)` across the union of affected `room_messages` and affected `attachments`. Both fields are `null` when total affected count is 0.
  - **Current Retention Resolution:** `current_retention_days` evaluates three-tier rule (`room_override` > instance default > server hard max), returning effective retention before the proposed change.
  - **Response Headers:** Returns `Cache-Control: no-store`.
  - **Rate Limit & Read-Only Invariant:** Endpoint is un-rate-limited and strictly read-only (database state is unmodified).
- **Link to report:** [verification/retention-preview-v3/report.md](verification/retention-preview-v3/report.md)

## V-F — `users.profile` Semantics and Avatar Storage Reconciliation
- **ID:** V-F
- **Date:** 2026-10-02
- **Status:** complete. Canonical.
- **Spec sections affected:** Server Spec v2.0 §2.4, §7.1, §7.2, §8.2.1, §8.2.2, §8.2.3, §8.2.4, §8.8, §14.3, §16, §17; Client Spec v1.0 §7.1, §8.4, §13.5, §13.6, §13.7, §17.1, §24
- **Question asked:** What are the visibility semantics of `users.profile` and `profile_version`, where does the user's avatar attachment ID live, how do `ui-profile` and `users.profile` relate, and is Task 32 unblocked?
- **Answer found:**
  - **Visibility Model:** `users.profile` and `profile_version` are strictly self-only (`GET /users/me`, `PATCH /users/me`). No endpoint (`POST /users/lookup`, `GET /rooms/:id/members`, etc.) ever exposes `profile` or `profile_version` to other users.
  - **Avatar Attachment Storage:** Confirmed Option A — the user's avatar attachment ID lives inside the client's opaque end-to-end encrypted profile payload stored in `users.profile`.
  - **Terminology Reconciliation:** `ui-profile` in Client Spec v1.0 §7.1 is the client-side UI Web Component renderer tag, while `users.profile` in Server Spec v2.0 §7.1 is the server database column storing the client-encrypted profile payload.
  - **Task 32 Status:** Task 32 (Avatar Upload) is unblocked under Interpretation A (V-E) without requiring any server schema changes.
- **Link to report:** [verification/users-profile/report.md](verification/users-profile/report.md)

## Task 32 — Attachments `room_id` Nullability for User-Scoped Attachments
- **ID:** Task 32
- **Date:** 2026-10-02
- **Status:** Complete. Canonical.
- **Spec sections affected:** §2.1, §7.7, §8.2.7
- **Question asked:** What is the schema contract for `attachments.room_id` for user-scoped attachments such as `POST /users/me/avatar`?
- **Answer found:**
  - `attachments.room_id` is nullable (`TEXT REFERENCES rooms(id) ON DELETE CASCADE`).
  - User-scoped attachments (such as user avatar uploads via `POST /users/me/avatar`) store `room_id = NULL` and set `uploader_id` to the calling user's ID.
  - The C2SP purpose string `"user-avatar"` is client-side only (used for C2SP encryption context derivation) and is not stored or validated server-side.

## Task 33 — Pending MLS Adds Endpoints and Event Contract
- **ID:** Task 33
- **Date:** 2026-10-02
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §2.1, §7.5, §8.5, §8.8
- **Question asked:** What are the canonical endpoint shapes, event names/payloads, and lifecycle invariants for MLS pending adds coordination?
- **Answer found:**
  - **Table Schema:** `pending_mls_adds` table (`id`, `room_id`, `target_user_id`, `target_client_id`, `key_package_id`, `queued_at`, `consumed_at`) created in `0032_pending_mls_adds.sql` with partial index `idx_pending_mls_adds_active` on `(room_id, consumed_at) WHERE consumed_at IS NULL`.
  - **Member Addition Behavior (`POST /rooms/:id/members`):**
    - Inserts one `pending_mls_adds` row per target client device using an unconsumed key package.
    - Consumes non-last-resort key packages (`consumed = 1, consumed_at = CURRENT_TIMESTAMP`).
    - After transaction commit, publishes event `mls.add_pending` on channel `private-room-{room_id}` with payload `{ "room_id": "<id>", "target_user_id": "<user_id>", "client_ids": ["<client_id>", ...] }`.
  - **List Endpoint (`GET /rooms/:id/pending-adds`):**
    - Returns active pending adds (`consumed_at IS NULL`) for room, ordered by `queued_at ASC, id ASC`.
    - Response body: `{ "pending_adds": [ { "id": "...", "target_user_id": "...", "target_client_id": "...", "key_package_id": "...", "queued_at": "..." } ] }`. Returns `Cache-Control: no-store`. Requires room membership (returns HTTP 404 `room_not_found` for non-members).
  - **Consume Endpoint (`POST /rooms/:id/pending-adds/:add_id/consume`):**
    - Marks pending add consumed by setting `consumed_at = CURRENT_TIMESTAMP`. Consumed rows persist (no automatic deletion).
    - Response body: `{ "id": "<add_id>", "consumed_at": "<iso_timestamp>" }`. Returns `Cache-Control: no-store`.
    - Error responses: HTTP 404 `pending_add_not_found` if missing or from another room; HTTP 409 `already_consumed` if previously consumed; HTTP 404 `room_not_found` if caller is not a room member.
  - **Spec Gap Note (`mls.welcome_ready`):** `mls.welcome_ready` is expected by Client Spec v1.0 but is absent from Server Spec v2.0 §8.8. It is not implemented by Task 33 and is flagged in the proposed §8.8 amendment.

## Task 34b — Key Transparency Merkle Tree, Signing Key, and Event Fanout
- **ID:** Task 34b
- **Date:** 2026-10-02
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §7.10, §8.3, §8.8, §9, §14.8, §16.35
- **Question asked:** What are the leaf serialization format, hash prefixes, signing key derivation formula, snapshot signing input format, and event fanout strategy for Key Transparency snapshots?
- **Answer found:**
  - **Leaf Canonical Serialization:**
    `serialize_leaf(username_token, identity_pubkey) = I2OSP(len(username_token), 2) || username_token || I2OSP(len(identity_pubkey), 2) || identity_pubkey`
    where lengths are 16-bit big-endian integers (`u16`) representing UTF-8 byte lengths.
  - **Leaf and Internal Node Hashing:**
    - Leaf hash: `SHA-256(0x00 || serialize_leaf(...))`
    - Node hash: `SHA-256(0x01 || left_hash || right_hash)`
    - Empty tree (`tree_size = 0`): `root_hash = SHA-256("")`
    - Single leaf (`tree_size = 1`): `root_hash = leaf_hash`
    - RFC 6962 split rule: largest power of two strictly less than $N$ (`k = 1 << (31 - (N - 1).leading_zeros())`).
  - **Ed25519 Signing Key Derivation (Option A):**
    Derived deterministically from the OPRF `ServerSetup` file:
    `root_secret = SHA-256(oprf_key_bytes)`
    `kt_signing_seed = HKDF-Expand(root_secret, info="key-transparency-signing-v1", length=32)`
  - **Signing Input Format:**
    `signing_input = I2OSP(tree_size, 8) || root_hash` (8-byte big-endian `u64` size prefix followed by 32-byte binary root hash).
  - **User Event Fanout (`kt.snapshot`):**
    Published per-user on channel `private-user-{user_id}` with `user_seq` increment. Payload: `{ "tree_size": tree_size, "root_hash": "<base64url>", "created_at": "<iso8601>" }`. (Note: snapshot signature is excluded from the event per §8.8).

## Task 34a — Key Transparency Log Insertion Point and Anonymization Invariants
- **ID:** Task 34a
- **Date:** 2026-10-02
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §2.1, §7.10, §8.3, §14.2, §14.8
- **Question asked:** What are the leaf insertion point, anonymization placeholder format, feature flag behavior, and cascade deletion invariants for `key_transparency_log`?
- **Answer found:**
  - **Insertion Point:** Leaves are appended to `key_transparency_log` inside the same database transaction as the `users` row insert during `POST /auth/register/finish`. Rollback of user registration guarantees rollback of the log append.
  - **Anonymization Placeholder Format:** During GDPR account deletion (`anonymise_user`), `key_transparency_log.user_id` is replaced with `anon_<32 hex>` (`anon_` followed by 32 lowercase hex characters). `username_token` and `identity_pubkey` remain unchanged as public audit records per §14.2.
  - **Feature Flag Behavior:** `KEY_TRANSPARENCY_ENABLED=false` prevents future leaf appends at registration time. Pre-existing log rows remain stored in the database and continue to be reported by `GET /api/v1/admin/key-transparency`.
  - **Cascade Note:** The foreign key `user_id REFERENCES users(id)` has `ON DELETE CASCADE`. Normal account deletion anonymizes `users` without deleting the row, so the cascade does not trigger. Hard SQL deletion of a user row will trigger cascade deletion of their log entries.

## Task 35 — Link Preview Proxy Mechanism and SSRF Guard Specifications
- **ID:** Task 35
- **Date:** 2026-10-02
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §2.1, §5.23, §5.6, §8.1.2
- **Question asked:** What are the Content Key encryption mechanism, request/response payload shapes, SSRF guard rules, and key configuration for the link preview proxy?
- **Answer found:**
  - **Content Key Mechanism:**
    - Server static keypair: 32-byte X25519 static key saved to `LINK_PREVIEW_PROXY_KEY_PATH` (0600 file permissions on Unix). Public key exposed in `GET /capabilities` as `link_preview_proxy_key`.
    - Key Agreement: Ephemeral-Static X25519 ECDH between client's ephemeral public key and server's static secret.
    - KDF: HKDF-SHA256 with `info = b"link-preview-content-key-v1"` deriving 32-byte Content Key.
    - Cipher: AES-256-GCM with 12-byte random nonce.
  - **Payload Shapes:**
    - Request Envelope: `{ "ephemeral_pubkey": "<base64_32B>", "nonce": "<base64_12B>", "ciphertext": "<base64>" }`
    - Response Envelope: `{ "nonce": "<base64_12B>", "ciphertext": "<base64>" }`
    - Request Plaintext: `{ "url": "<https URL>", "request_id": "<string>" }`
    - Response Plaintext: `{ "status": <u16>, "headers": { ... }, "body": "<base64>", "request_id": "<string>" }`
    - Error Plaintext: `{ "error": "<code_string>", "request_id": "<string>" }`
  - **SSRF Guard Rules:**
    - Scheme: `https://` required in production (`http://` rejected with `url_blocked`).
    - IP Range Checks: Loopback (`127.0.0.0/8`, `::1`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), link-local (`169.254.0.0/16`, `fe80::/10`), multicast (`224.0.0.0/4`, `ff00::/8`), reserved (`0.0.0.0/8`, `240.0.0.0/4`, `100.64.0.0/10`, `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`), IPv4-mapped IPv6, and metadata services (`169.254.169.254`, `fd00:ec2::254`) are blocked (`url_blocked`).
    - Rebinding Protection: Connections are pinned to the verified target IP address while retaining original hostname for SNI and Host header.
    - Redirect Handling: Max 5 redirects; target URL scheme and IP resolution re-evaluated per redirect hop.
  - **Configuration & Operational Invariants:**
    - Rate limit: `RATE_LINK_PREVIEW_PER_MIN` (default 10) per user, key `link_preview:{user_id}:min:{boundary}`.
    - Response size cap: `LINK_PREVIEW_PROXY_MAX_BYTES` (default 1,048,576 bytes). Incremental decompression cap for gzip/deflate.
    - Plaintext non-persistence & no-audit: Plaintext URLs are decrypted solely in memory, never logged, and never written to audit logs or database tables.

## Task 40a — Session Types Configuration & Atomic Reload Contract
- **ID:** Task 40a
- **Date:** 2026-10-03
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §5.26, §5.26.1, §8.1, §8.3.1, §9, §14.8
- **Question asked:** What are the effective state semantics of `sessions_enabled`, the TOML schema/validation rules, the atomic reload guarantee, empty allowlist decision, and response shapes for `GET /capabilities` vs `POST /admin/session-types/reload`?
- **Answer found:**
  - **Effective State Semantics:**
    - `effective_enabled = declared_enabled && allowlist_loaded`.
    - `SESSIONS_ENABLED=true` + missing/malformed file -> startup logs an error, server continues running, `sessions_enabled` in capabilities reports `false`, `session_types` reports `[]`.
    - `SESSIONS_ENABLED=false` -> file is not read, capabilities reports `sessions_enabled: false` and `session_types: []`.
  - **TOML Schema & Validation:**
    - Schema: Array of tables `[[session_type]]` with `type` (starts with letter, lowercase/digits/hyphen/underscore regex `^[a-z][a-z0-9_-]*$`), `extension_id` (non-empty string), `max_participants` (`≥ 1` and `≤ SERVER_MAX_SESSION_PARTICIPANTS`), `max_per_room` (`≥ 1` and `≤ SERVER_MAX_SESSIONS_PER_ROOM`).
    - Duplicate `type` values are rejected.
    - Errors report line number and human-readable reason.
  - **Empty Allowlist Behavior:**
    - An empty TOML file or file with `session_type = []` is valid. `sessions_enabled` is reported as `true` (if `SESSIONS_ENABLED=true`), but `session_types` is `[]` (no session types can be created).
  - **Atomic Reload Guarantee:**
    - Stores allowlist in `SessionTypesStore` with lock-free atomic `swap`.
    - `POST /api/v1/admin/session-types/reload` re-reads `SESSION_TYPES_CONFIG_PATH`.
    - On validation error: leaves previous config unmodified, returns HTTP 400 with `line` and `reason` details, writes no audit log.
    - On success: swaps in-memory state atomically, updates effective state, writes audit log `session_types.reload` with metadata `{"types_count": N}`, returns HTTP 200.
  - **Capabilities vs Admin Reload Response Shapes:**
    - Capabilities (`GET /api/v1/capabilities`): 3 fields in `session_types[]` (`extension_id`, `type`, `max_participants`), sorted by `type` ascending.
    - Admin Reload (`POST /api/v1/admin/session-types/reload`): 4 fields in `session_types[]` (`type`, `extension_id`, `max_participants`, `max_per_room`).

## Task 42 — Starred Items Architecture, Cursor Format, Limit, and Event Contracts
- **ID:** Task 42
- **Date:** 2026-10-03
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §2.1, §4.2, §5.6, §5.29, §7.2, §8.2.4, §8.2.9, §8.8, §14.2, §14.3, §16.15
- **Question asked:** What are the cursor format, limit semantics, tombstone model, event shapes, rate limit decision, sync integration, and GDPR handling for starred items?
- **Answer found:**
  - **Relational Schema:** `starred_items` table created in `0034_starred_items.sql` with composite PK `(user_id, item_id, item_type)`, FKs `users(id)` and `rooms(id)` `ON DELETE CASCADE`, `user_seq`, `starred_at`, and nullable `deleted_at`. Indexes `idx_starred_items_seq` on `(user_id, user_seq)` and `idx_starred_items_room` on `(user_id, room_id, starred_at DESC)`.
  - **Config & Limit Semantics:** `SERVER_MAX_STARRED_ITEMS_PER_USER` default 10,000, validated range `100..=100000`. Limits count active stars (`deleted_at IS NULL`). Exceeding limit returns HTTP 409 `starred_items_limit_reached` (no silent eviction).
  - **POST /users/me/starred-items:** Requires room membership (returns 404 `room_not_found` if non-member), validates `item_type` (`attachment`, `message`, `link`), idempotent 200 OK for existing active star, 201 Created for fresh star or re-star (clearing `deleted_at`, bumping `user_seq`, updating `starred_at = now`). Post-commit publishes `starred_item.added` (`{ "item_id": "...", "item_type": "...", "room_id": "...", "user_seq": N }`) to `private-user-{user_id}`.
  - **DELETE /users/me/starred-items/:item_id?item_type=:** Sets `deleted_at = now`, bumps `user_seq`, returns 204 No Content (404 `starred_item_not_found` if missing or already tombstoned). Post-commit publishes `starred_item.removed` (`{ "item_id": "...", "item_type": "...", "user_seq": N }` - note: NO `room_id` per §8.8) to `private-user-{user_id}`.
  - **Rate Limit:** Reuses `RateLimitKey::Edit` (`RATE_EDIT_PER_MIN`, default 30/min, key format `edit:{user_id}:min:{boundary}`).
  - **List Endpoint (`GET /users/me/starred-items`):** Filters by `type` and `room_id`, `include_deleted` (default false), limit (default 100, clamped to max 500). Orders by `(starred_at DESC, item_id ASC, item_type ASC)`.
  - **Cursor Format:** Opaque unpadded base64url JSON struct `{"user_id": "<uid>", "last_item_id": "<id>", "last_item_type": "<type>"}` (server also includes optional `last_starred_at`). Mismatched `user_id` or malformed payload returns HTTP 400 `invalid_cursor`.
  - **Sync Integration (`GET /users/me/sync`):** Returns `starred_items` filtered by `user_seq > since_seq` ordered by `user_seq ASC` (including tombstones) and incorporates `max_starred_seq` into response `max_seq`.
  - **GDPR:** Account deletion explicitly deletes user rows in `anonymise_user`. Data export includes `starred_items.json` in the ZIP archive.

## Task 41a — Local Model Hosting Contract and Endpoint Shapes
- **ID:** Task 41a
- **Date:** 2026-10-03
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §2.1, §5.6, §5.27, §8.1, §8.1.3, §8.1.4, §8.3, §14.8, §16.14
- **Question asked:** What are the manifest JSON schema, voice metadata source, URL structure, ETag derivation, capability fields, base URL construction, and rate limiting rules for local mode model hosting?
- **Answer found:**
  - **Manifest JSON Schema:**
    - Schema version: `schema_version == 1`.
    - `{STT_MODELS_PATH}/manifest.json` and `{TTS_MODELS_PATH}/manifest.json`.
    - Models array: `[ { "id": "<string>", "version": <u32 >= 1>, "size_bytes": <u64>, "files": [ { "name": "<string>", "size_bytes": <u64>, "sha256": "<64 hex chars>" } ] } ]`.
    - Validation: Unique model IDs per manifest. Filenames must contain only `[A-Za-z0-9._-]` (no `..`, `/`, `\`).
  - **Voice Metadata Source:**
    - TTS model voice metadata is loaded from side file `{TTS_MODELS_PATH}/{model_id}/{version}/voices.json`.
    - Format: `{ "languages": ["en-US", ...], "voices": [ { "id": "...", "language": "en-US", "gender": "neutral" } ] }`.
    - If `voices.json` is missing or invalid, falls back to `languages: ["*"]` and `voices: []`.
  - **URL Structure & File Serving:**
    - Routes: `GET /models/stt/v1/:model_id/:version/:filename` and `GET /models/tts/v1/:model_id/:version/:filename`.
    - Public, unauthenticated endpoints.
    - Path traversal rejection: Any byte outside `[A-Za-z0-9._-]` or presence of `..`, `/`, `\` returns HTTP 400 `invalid_filename`.
    - ETag Derivation: `ETag: "<sha256>"` where `<sha256>` is taken directly from the manifest's file entry (quoted). Not re-hashed at serve time.
    - Headers: `Cache-Control: public, max-age=31536000, immutable`, `Content-Type: application/octet-stream`.
    - Conditional Requests: `If-None-Match` matching ETag returns 304 Not Modified.
    - Range Requests: Supports single-range `Range: bytes=N-M` returning 206 Partial Content with `Content-Range`. Multi-range (`bytes=a-b,c-d`) returns 416 Range Not Satisfiable.
  - **Manifest Endpoint (`GET /models/manifest.json`):**
    - Returns combined JSON `{ "stt": { "default_model": "...", "base_url": "...", "models": [...] }, "tts": { ... } }`.
    - Headers: `Cache-Control: public, max-age=3600`, `Content-Type: application/json`.
    - Returns HTTP 200 with empty model lists if manifests are unconfigured/missing.
  - **Capabilities (`GET /api/v1/capabilities`):**
    - Exposes 7 fields when `MODEL_HOSTING_ENABLED=true`: `model_hosting_enabled: true`, `model_hosting_mode: "local"`, `stt_models_base_url`, `stt_default_model`, `tts_models_base_url`, `tts_default_model`, and `tts_models[]` (with `languages` and `voices`).
    - Fields are omitted (or null) when `MODEL_HOSTING_ENABLED=false`.
    - Base URLs are constructed from `APP_URL` (or default `http://localhost:8080`) with trailing slashes.
  - **Admin Reload (`POST /api/v1/admin/models/reload`):**
    - Re-reads and validates both manifests atomically.
    - On validation error: leaves previous manifests in place, returns HTTP 400 `invalid_model_manifest`, writes no audit entry.
    - On success: swaps manifests atomically, writes audit entry `model.manifest_reload` with metadata `{"stt_models": N, "tts_models": M}`, returns HTTP 200 `{ "reloaded": true, "stt_models": N, "tts_models": M }`.
  - **Rate Limiting:**
    - File serving routes enforced via `RateLimitKey::ModelDownload { ip }` (`RATE_MODEL_DOWNLOAD_PER_MIN`, default 30/min per IP, key format `model_download:{ip}:min:{boundary}`).
    - `GET /models/manifest.json` is exempt from rate limiting.

## Task 36a — Call Signaling, `call_id` Source, Column Disposition, and Event Contract
- **ID:** Task 36a
- **Date:** 2026-10-03
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §2.1, §5.24, §7.4, §7.9, §8.1, §8.7, §8.8
- **Question asked:** What are the `call_id` source, `rooms.call_active`/`rooms.call_participants` column disposition, `call.signal` event shape/fanout, capabilities fields, and spec amendments for call signaling?
- **Answer found:**
  - **`call_id` Source (Option A - Client-Generated):** `call_id` is generated by the client (UUID or similar). The server lazily creates a `call_sessions` row on the first signal for that ID in the room, setting `initiator_id` to the first caller and `started_at = CURRENT_TIMESTAMP`. If a `call_id` is reused across different rooms, `POST /rooms/:id/calls/:call_id/signal` returns HTTP 409 `call_id_conflict`.
  - **`rooms.call_participants` & `rooms.call_active` Disposition:** `call_participants` table (§7.9) is the authoritative source of participant membership. The legacy columns `rooms.call_active` and `rooms.call_participants` on the `rooms` table (§7.4) remain untouched and unused in this task.
  - **Capabilities Exposure:** `GET /capabilities` exposes `calling` (boolean, matching `CALLING_ENABLED` config) and `call_max_participants` (u32, default 8).
  - **Signaling Relay Endpoint (`POST /rooms/:id/calls/:call_id/signal`):**
    - Unauthenticated -> 401 Unauthorized.
    - Non-room member -> 404 `room_not_found`.
    - `CALLING_ENABLED=false` -> 501 `calling_disabled`.
    - Opaque payload & signal_type: payload strings (base64) and signal types are relayed verbatim without parsing or logging.
    - Participant tracking: caller is added to `call_participants` (`joined_at = CURRENT_TIMESTAMP`, `left_at = NULL`).
    - Event fanout: Broadcasts non-durable `call.signal` event on `private-user-{target_user_id}` for every other active participant in the call (`user_id != caller_id AND left_at IS NULL`). Payload: `{ "call_id": "<call_id>", "sender_user_id": "<caller_user_id>", "signal_type": "<type>", "payload": "<base64>" }`.
    - No events published on `private-room-{room_id}`.
    - Response: HTTP 202 Accepted `{ "delivered_to": count }` where `count` is the number of target user channels.
  - **Proposed §16 Spec Amendment:**
    - Document that `call_id` in `/rooms/:id/calls/:call_id/signal` is chosen by the client and lazily initializes the `call_sessions` row on first signal.
    - Document that `call.signal` is user-scoped (`private-user-{user_id}`), broadcast-only (relayed to all other active call participants), and non-durable.
    - Document that the `call_participants` table is authoritative over the `rooms.call_participants` text column.

## Task 36b — Call Lifecycle Events, End Endpoint, and Authorization
- **ID:** Task 36b
- **Date:** 2026-10-03
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §2.1, §4.5, §8.7, §8.8, §14.8
- **Question asked:** When do `call.started` and `call.ended` fire, who may end a call, what happens to call participants on end, and what are the idempotency and audit requirements?
- **Answer found:**
  - **`call.started` Event & `call.start` Audit:** Fires exactly once following the atomic creation commit of a `call_sessions` row during first signal in `send_signal`.
    - Event channel: `private-room-{room_id}` (room channel).
    - Event payload: `{ "call_id": "<call_id>", "room_id": "<room_id>", "initiator_id": "<user_id>", "started_at": "<iso8601>" }`.
    - Audit entry: `call.start` with metadata `{ "call_id": "<call_id>", "room_id": "<room_id>" }`.
    - Subsequent signals on an existing call session do NOT re-publish `call.started` or re-write `call.start` audit log.
  - **`POST /api/v1/rooms/:id/calls/:call_id/end` Endpoint:**
    - Unauthenticated -> 401 Unauthorized.
    - Non-room member -> 404 `room_not_found`.
    - Call not found or belonging to a different room -> 404 `call_not_found`.
    - `CALLING_ENABLED=false` -> 501 `calling_disabled`.
    - Authorization: Requires caller to be the call initiator (`initiator_id`) or the room owner (`rooms.owner_id`). Non-initiator non-owner members receive HTTP 403 `forbidden`.
  - **Participant Disposition & End Execution:**
    - Updates `call_sessions.ended_at = CURRENT_TIMESTAMP` and sets `call_participants.left_at = CURRENT_TIMESTAMP` for all active participants (`left_at IS NULL`) in a single transaction.
    - Post-commit: publishes `call.ended` on `private-room-{room_id}` with payload `{ "call_id": "<call_id>", "room_id": "<room_id>", "ended_at": "<iso8601>" }` and logs `call.end` audit entry with metadata `{ "call_id": "<call_id>", "room_id": "<room_id>" }`.
  - **Idempotency:**
    - Subsequent `/end` requests on an already-ended call return HTTP 200 with the existing session state (`ended_at` set) without re-writing database rows, re-publishing `call.ended`, or re-writing audit logs.
  - **Abandoned Call Gap Note:**
    - Calls that are never explicitly ended retain `ended_at = NULL`. §4.5 call state cleanup only cleans up rows where `ended_at` is set (`ended_at < now - 24h`). Auto-termination for abandoned calls is flagged for future spec amendment.

## Task 37 — TURN Credentials HMAC Format, Response Shape, and Startup Rules
- **ID:** Task 37
- **Date:** 2026-10-03
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §2.1, §5.6, §5.24, §8.7, §8.7.1
- **Question asked:** What are the exact username format, HMAC construction, response shape, multi-URL splitting convention, rate limit, and startup validation rules for TURN credentials?
- **Answer found:**
  - **Username Format:** `<expiry_timestamp>:<opaque>` where `expiry_timestamp` is Unix epoch seconds (`now + TURN_TTL_SECONDS`) and `opaque` is 16 random bytes encoded using unpadded Base64URL (`URL_SAFE_NO_PAD`). The user ID is explicitly excluded to protect privacy in coturn server logs.
  - **HMAC Construction:** Standard Base64 encoded `HMAC-SHA1(TURN_SHARED_SECRET, username)`. HMAC-SHA1 is used per coturn REST API convention for native compatibility.
  - **Response Shape:**
    ```json
    {
      "urls": ["turn:turn.example.com:3478", "turns:turn.example.com:5349"],
      "username": "1735689600:AbCdEfGhIjKlMnOp",
      "credential": "dGVzdC1jcmVkZW50aWFs==",
      "ttl": 600
    }
    ```
  - **URL Splitting:** `TURN_URL` supports comma-separated URLs (e.g. `turn:1.2.3.4:3478,turns:5.6.7.8:5349`). The server splits on commas and trims whitespace into the `urls` array response.
  - **Rate Limiting:** `RATE_TURN_CREDENTIALS_PER_MIN` (default 10) per user, rate limit key `turn_credentials:{user_id}:min:{boundary}`.
  - **Startup Validation:** If `TURN_URL` is set (non-empty), `TURN_SHARED_SECRET` MUST also be non-empty; otherwise server startup bails with `"TURN_URL is set but TURN_SHARED_SECRET is empty"`. Conversely, an empty `TURN_URL` denotes TURN is disabled (`POST /calls/turn-credentials` returns 501 `turn_not_configured`).
  - **No Audit / No Events:** Endpoint generates short-lived credentials without state persistence, audit logging, or Sockudo event publishing.

## Task 40b — Sessions CRUD, Position Re-sequencing, and Event Contract
- **ID:** Task 40b
- **Date:** 2026-10-03
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §2.1, §5.6, §5.26.1, §7.9, §8.7, §8.8, §14.8, §16.23, §16.24, §16.25
- **Question asked:** What are the position re-sequencing rules, `metadata_version` increment rules, `session.updated` event payload shape, no-op patch behavior, and room-deletion cascade event timing for room sessions?
- **Answer found:**
  - **Relational Schema:** `room_sessions` table created in `0036_room_sessions.sql` per §7.9 and Amendment 36 with `idx_room_sessions_room_pos` on `(room_id, position ASC)` and `idx_room_sessions_created_by` on `(created_by)`.
  - **Dense Position Re-sequencing:** Sessions within a room maintain dense 0..N-1 positions ordered by `position ASC, id ASC` (stable tie-breaking by primary key `id`).
    - **Create:** Inserting at position $P$ shifts existing sessions at $\ge P$ up by 1 and re-sequences the list to 0..N-1. Omitted position appends at end ($N$).
    - **Patch:** Moving a session to position $P$ reorders the list and re-sequences remaining sessions to dense 0..N-1.
    - **Delete:** Deleting a session re-sequences remaining sessions to dense 0..N-1.
  - **`metadata_version` Increment Rules:**
    - Increments by 1 on every successful `PATCH` that modifies `metadata`.
    - Does **not** increment on position-only updates.
  - **`session.updated` Event Shape:**
    - Payload includes `changed` array (`["metadata"]`, `["position"]`, or `["metadata", "position"]`).
    - `metadata` and `metadata_version` fields are present in payload iff `"metadata"` is in `changed`.
    - `position` field is present in payload iff `"position"` is in `changed`.
  - **No-Op Patch Behavior:**
    - A `PATCH` supplying values equal to current state returns HTTP 200 with the current session view item, but publishes no `session.updated` event and writes no audit entry.
  - **Room-Deletion Cascade Event Timing:**
    - On room deletion (`DELETE /rooms/:id` or `leave_room` as sole member), `publish_room_sessions_deleted` queries active `room_sessions` and publishes `session.deleted` (`{ "room_id": "...", "session_id": "...", "extension_id": "..." }`) on `private-room-{room_id}` for each session before committing the database room deletion transaction per §8.7.12.
  - **Disabled Mode Semantics:**
    - `POST /api/v1/rooms/:id/sessions` returns HTTP 501 `sessions_disabled` when `sessions_enabled == false`.
    - `GET`, `PATCH`, and `DELETE` remain available and functional when `sessions_enabled == false` per §8.7.13.
  - **Audit Logging:**
    - `session.create` written on successful create; `session.delete` written on successful delete. No audit log is written on patch.

## Task 40c — Sessions Occupancy, Join, Leave, Heartbeat, Roster
- **ID:** Task 40c
- **Date:** 2026-10-04
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §5.6, §5.26, §7.9, §8.7.7, §8.7.8, §8.7.9, §8.7.10, §8.7.13, §8.8, §12, §16.23
- **Question asked:** What are the canonical occupancy storage guarantees, roster response shape/ordering, participant cap semantics, debounce contract, stale participant timeout, cross-device leave behavior, disabled mode mechanics, media_config ICE server sources, and event ordering on session teardown?
- **Answer found:**
  - **In-Memory Occupancy Storage Model:**
    - Occupancy is strictly in-memory (`OccupancyStore(Arc<RwLock<HashMap<session_id, SessionOccupancy>>>)`).
    - Never persisted to SQLite or disk, never written to any log line, tracing span, metric, or audit log row.
    - Dropped on process termination; restarted server begins with empty occupancy requiring clients to rejoin.
  - **Roster Shape & Ordering:**
    - Returns `{ "roster": [ { "user_id": "u_1", "client_ids": ["c_a", "c_b"] } ] }`.
    - Sorted strictly by `user_id ASC`, with `client_ids` array sorted ascending within each user item.
  - **Participant Cap Semantics:**
    - Caps distinctly count human users (`participants.len()`), NOT device `client_id`s. A user with multiple devices counts as 1 towards the cap.
    - Cap is taken from session type's `max_participants` (falling back to `SERVER_MAX_SESSION_PARTICIPANTS`).
    - Exceeding cap returns HTTP 409 `session_full` without evicting existing participants.
  - **Debounce Engine & Event Contract:**
    - `session.occupancy` carries count only: `{ "room_id": "...", "session_id": "...", "participant_count": N }` on `private-room-{room_id}`.
    - Coalesces changes per session to at most 1 publish per `SESSION_OCCUPANCY_DEBOUNCE_MS` (default 1000ms).
    - Teardown of empty sessions publishes a final `session.occupancy` with `participant_count: 0` before purging in-memory state.
  - **Stale Participant Cleanup:**
    - Background task runs periodically at `max(SESSION_HEARTBEAT_TIMEOUT_SECONDS / 3, 1)` seconds.
    - Prunes device `client_id`s whose `last_heartbeat` exceeds `SESSION_HEARTBEAT_TIMEOUT_SECONDS`.
  - **Cross-Device Leave Semantics:**
    - Accepts any `client_id` belonging to the authenticated user (validated via `devices::find_by_client_id`).
    - Removing a single `client_id` leaves other devices of the same user active in the session.
  - **Disabled Mode Semantics (§8.7.13):**
    - When `sessions_enabled == false`: `POST .../join`, `POST .../leave`, and `POST .../heartbeat` return HTTP 501 `sessions_disabled`.
    - `GET .../roster` returns HTTP 403 `not_a_participant`.
    - `GET /rooms/:id/sessions` returns 200 with `participant_count: 0`.
  - **`media_config.ice_servers` Source:**
    - Join response calls TURN credential generator from Task 37. Returns empty `ice_servers` array if `TURN_URL` is unconfigured, or if `CALLING_ENABLED=false`.
  - **Event Ordering on Teardown:**
    - Session deletion (`DELETE /rooms/:id/sessions/:id` or room deletion) tears down occupancy and emits `session.occupancy` (count 0) immediately before publishing `session.deleted`.
  - **Proposed Spec Amendments (§16 Amendment 38):**
    1. *Disabled Mode Leave:* Clarify that `POST .../leave` returns HTTP 501 `sessions_disabled` when `sessions_enabled=false`.
    2. *Session Teardown Event Order:* Specify that on session deletion, `session.occupancy` with `participant_count: 0` is published immediately before `session.deleted`.
    3. *Media Config on Calling Disabled:* Clarify that `media_config.ice_servers` in join response is empty when calling is disabled.

## Task 40d — Session Signaling Relay, Event Contract, and Rate Limiting
- **ID:** Task 40d
- **Date:** 2026-10-04
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec sections affected:** §5.6, §8.7.11, §8.7.13, §8.8, §14.8, §16.23, §16.25
- **Question asked:** What are the unicast vs broadcast routing rules, `delivered_to` user counting semantics, `session.signal` event payload shapes, self-delivery contract, rate-limit key format, `target_not_found` semantic, and opacity invariants for session signaling?
- **Answer found:**
  - **Unicast vs Broadcast Routing Rules:**
    - **Unicast (`target_client_id` present):** Target device owner user ID is resolved via `OccupancyStore::find_user_for_client`. If target client is not in session -> HTTP 404 `target_not_found`. Event published on `private-user-{target_user_id}`. Returns HTTP 200 `{ "delivered_to": 1 }`.
    - **Broadcast (`target_client_id` absent):** Participant user IDs enumerated excluding caller's `user_id`. Event published on `private-user-{target_user_id}` for each distinct target user. Returns HTTP 202 Accepted `{ "delivered_to": <user_count> }`.
  - **`delivered_to` Counting:** Counts human users, NOT device `client_id`s. A broadcast to a session with 1 other user having 3 devices returns `delivered_to: 1`. Broadcast when caller is the only participant returns `delivered_to: 0`.
  - **`session.signal` Event Payload Shapes (§8.8):**
    - Unicast payload: `{ "room_id": "...", "session_id": "...", "sender_user_id": "...", "sender_client_id": "...", "target_client_id": "...", "signal_type": "...", "payload": "..." }`.
    - Broadcast payload: `{ "room_id": "...", "session_id": "...", "sender_user_id": "...", "sender_client_id": "...", "signal_type": "...", "payload": "..." }` (note: `target_client_id` is absent).
    - Events are non-durable (`user_seq = 0`, live delivery only).
  - **Self-Delivery Contract:** Unicast targeting caller's own client ID publishes unconditionally on `private-user-{caller_user_id}`. The originating client receives its own event and drops it by matching `sender_client_id` against its own `client_id`.
  - **Rate Limiting:** Rate limit `RATE_SESSION_SIGNAL_PER_MIN` (default 120/min per user per session) enforced on the sender via key `session_signal:{user_id}:{session_id}:min:{boundary}`. Broadcast amplification does NOT consume additional sender quota (counts as 1 request). Exceeding limit returns HTTP 429 with `Retry-After` header.
  - **`target_not_found` Semantic:** HTTP 404 with error `"target_not_found"` when `target_client_id` is not present in the session's participant roster. Distinct from URL-level 404; no roster payload returned in error response.
  - **Opacity Invariants:** Server validates `signal_type` length ($\le 128$ bytes) and `payload` Base64 decoding size ($\le 64\text{ KiB}$), but never inspects, parses, logs, or stores signal content. Locks on `OccupancyStore` are released before pub/sub event emission. No audit entries are written (§14.8).
  - **Disabled Mode:** When `sessions_enabled == false`, returns HTTP 501 `sessions_disabled` per §8.7.13.

## Task 45.3 — Extension Proxy Configuration, Capabilities, Domain Blocklist, Audit
- **ID:** Task 45.3
- **Date:** 2026-10-04
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec / Amendment references:** Amendment 38 (§5.1, §6, §7, §8.3, §9, §14.8), Client Spec v1.0 (§26.11)
- **Domain Blocklist Store & Loading Semantics:**
  - `DomainBlocklistStore` manages `DomainBlocklist` wrapped in `RwLock`.
  - Normalizes entries: trims, lowercases, and validates syntax against regex `^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`.
  - Combines sources: `EXTENSION_PROXY_DENY_DOMAINS` (comma-separated string) and `EXTENSION_PROXY_DENY_DOMAINS_PATH` (file on disk, one per line, `#` comments allowed).
  - Malformed entries in config or file generate warnings and are skipped without failing startup or blocklist reloads.
- **Blocklist Enforcement & Order of Checks:**
  - Evaluated post-decryption during outbound fetch execution (`execute_outbound_fetch`).
  - IP literals and private IPs are evaluated first by the SSRF guard (`is_ip_blocked`), returning HTTP 400 `url_blocked`.
  - Blocklist matching rule: host `H` matches suffix `S` if `H == S` or `H` ends with `.<S>` (whole label boundary matching). Case-insensitive.
  - On match, rejects with HTTP 400 `domain_blocked` ("Domain is blocked by the operator") using encrypted error envelope without revealing host or matching suffix in response.
- **Capabilities Advertisement (`GET /capabilities`):**
  - Exposes five fields: `extension_proxy_enabled` (bool), `extension_proxy_max_request_bytes` (u64), `extension_proxy_max_response_bytes` (u64), `extension_proxy_supports_streaming` (`false`), and `extension_proxy_key` (Base64 string of X25519 public key when enabled, `null` when disabled).
- **Hourly Audit Aggregation (`extension.proxy_request`):**
  - Scheduled background task runs hourly (`run_hourly_audit_aggregation_job`).
  - Reads request counts from `rate_limits` table (`extension_proxy:{user_id}:{extension_id}:hour:{boundary}`) for the closed hour boundary.
  - Writes single `extension.proxy_request` audit entry per active `(user_id, extension_id)` pair with `metadata: { "extension_id": "<id>", "request_count": <int> }`.
  - Zero-count pairs write no audit entries.
- **Admin Blocklist Reload Endpoint:**
  - `POST /api/v1/admin/extension-proxy/reload-blocklist` requires admin authorization (`ConfigEdit` permission).
  - Re-reads file and env sources, validates, and performs an atomic swap on `DomainBlocklistStore`.
  - Returns HTTP 200 `{ "reloaded": true, "suffix_count": N }`. If file is missing, returns HTTP 400 `blocklist_file_not_found`; on read error, returns HTTP 400 `blocklist_load_failed` without mutating previous blocklist.
  - Writes no audit log entry (§14.8).

## Task 45.2 — Extension Proxy Rate Limiting and Bandwidth Accounting
- **ID:** Task 45.2
- **Date:** 2026-10-04
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec / Amendment references:** Amendment 38 (§5.1, §5.2, §5.3)
- **Two-Bucket Rate Limiting Scheme:**
  - Evaluated post-decryption in `check_rate_limits` inside a single SQL transaction.
  - Checks 4 rate limit windows in strict order:
    1. Per-extension minute: `extension_proxy:{user_id}:{extension_id}:min:{boundary}` <= `EXTENSION_PROXY_MAX_REQUESTS_PER_MIN` (default 60)
    2. Per-extension hour: `extension_proxy:{user_id}:{extension_id}:hour:{boundary}` <= `EXTENSION_PROXY_MAX_REQUESTS_PER_HOUR` (default 500)
    3. Total minute: `extension_proxy_total:{user_id}:min:{boundary}` <= `EXTENSION_PROXY_MAX_REQUESTS_PER_MIN_TOTAL` (default 120)
    4. Total hour: `extension_proxy_total:{user_id}:hour:{boundary}` <= `EXTENSION_PROXY_MAX_REQUESTS_PER_HOUR_TOTAL` (default 1000)
  - On failure, rolls back the transaction so rejected requests do not consume quota. Returns HTTP 429 `rate_limited` with `Retry-After` header and encrypted error payload `details.retry_after`.
- **Bandwidth Accounting:**
  - Evaluated post-fetch in `check_and_record_bandwidth` inside a single SQL transaction.
  - Measures raw decrypted request body bytes (`req_plain.body`) + raw decrypted response body bytes (`res.body_bytes`). Response headers and base64 overhead are strictly excluded.
  - Checks 4 bandwidth windows:
    1. Per-extension hour: `extension_proxy_bw:{user_id}:{extension_id}:hour:{boundary}` <= `EXTENSION_PROXY_MAX_BANDWIDTH_PER_HOUR_BYTES` (default 50 MB)
    2. Per-extension day: `extension_proxy_bw:{user_id}:{extension_id}:day:{boundary}` <= `EXTENSION_PROXY_MAX_BANDWIDTH_PER_DAY_BYTES` (default 500 MB)
    3. Total hour: `extension_proxy_bw_total:{user_id}:hour:{boundary}` <= `EXTENSION_PROXY_MAX_BANDWIDTH_PER_HOUR_BYTES_TOTAL` (default 100 MB)
    4. Total day: `extension_proxy_bw_total:{user_id}:day:{boundary}` <= `EXTENSION_PROXY_MAX_BANDWIDTH_PER_DAY_BYTES_TOTAL` (default 1 GB)
  - On failure, rolls back the transaction and returns HTTP 429 `bandwidth_limited` with `Retry-After` header and encrypted error payload `details.retry_after`.
- **`extension_id` Rotation Resistance:**
  - Enforced by the aggregate total bucket (`extension_proxy_total` and `extension_proxy_bw_total`).
  - Rotating `extension_id` bypasses the per-extension bucket but cannot exceed total per-user quotas.
- **Data Store & Cleanup Integration:**
  - Reuses the `rate_limits (key, window_start, count)` table without schema migration. The 64-bit integer `count` stores request counts or byte counts.
  - Automatically pruned by the existing hourly `RateLimitsJob` background task (rows older than 24h are deleted).
- **Error Shapes & `Retry-After` Computation:**
  - Calculates `retry_after = max(window_reset_at - now)` in seconds across offending windows.
  - Returns outer HTTP header `Retry-After: <sec>` and encrypted error JSON body:
    `{ "error": "rate_limited" | "bandwidth_limited", "message": "...", "details": { "retry_after": <sec> }, "request_id": "<id>" }`.

## Task 45.1 — Extension Proxy Core Relay
- **ID:** Task 45.1
- **Date:** 2026-10-04
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec / Amendment references:** Amendment 38 (§3, §4, §5.1, §11, §12)
- **Reused Mechanism & Content Key Derivation:**
  - Reuses Task 35's Content Key encryption envelope (`RequestEnvelope`, `ResponseEnvelope`), X25519-ECDH shared secret derivation, and AES-256-GCM cipher.
  - Distinct HKDF info string for extension proxy: `"extension-proxy-content-key-v1"` (prevents replay between link preview and extension proxy).
  - Key file reuse: Reuses `LINK_PREVIEW_PROXY_KEY_PATH` X25519 private key. Loaded when `link_preview_proxy_enabled || extension_proxy_enabled`.
- **Request / Response Plaintext Envelopes:**
  - Request Plaintext: `{ "url": "https://...", "method": "GET"|"POST"|"HEAD", "headers": Option<HashMap<String, String>>, "body": Option<String>, "extension_id": "<1..128b>", "request_id": "<1..128b>" }`.
  - Response Plaintext: `{ "status": <u16>, "headers": HashMap<String, String>, "body": "<base64-bytes>", "request_id": "<echoed>" }`.
  - Encrypted Error Plaintext: `{ "error": "<code>", "message": "<msg>", "request_id": Option<String> }`.
- **Header Allowlists:**
  - Request header allowlist: `Accept`, `Accept-Language`, `Accept-Encoding`, `Cache-Control`, `If-None-Match`, `If-Modified-Since`, `If-Range`, `Range`. Any non-allowlisted header (or `Authorization`/`Cookie`) is rejected with 400 `header_not_allowed`.
  - Response header allowlist: `content-type`, `content-length`, `etag`, `last-modified`, `cache-control`, `expires`, `date`, `vary`, `location`, `retry-after`.
  - `User-Agent`: Forced to `EXTENSION_PROXY_USER_AGENT` (`Atoll/2.0` default). Client `User-Agent` headers are stripped.
- **Redirect Policy per Method:**
  - `GET` / `HEAD`: Follows 301, 302, 303, 307, 308 up to 5 hops max, validating every hop against the SSRF guard.
  - `POST`: Follows 307 and 308 (preserving POST method and body). 301, 302, 303 are returned to the client without following, with status and `Location` header in the encrypted response.
- **Content Encoding & Size Limit Enforcement:**
  - Decompresses `gzip` and `deflate` transparently using bounded stream readers. Strips `content-encoding` and `content-length` from response headers when decompressed.
  - Response size limit (`EXTENSION_PROXY_MAX_RESPONSE_BYTES`, default 10 MiB) applies strictly to decompressed bytes. If exceeded, returns HTTP 502 `upstream_response_too_large` without truncating.
  - Request body limit (`EXTENSION_PROXY_MAX_REQUEST_BYTES`, default 256 KiB) enforced on the HTTP layer before decryption (returns HTTP 413 `request_too_large`).
- **Error Codes & Behavior:**
  - `400 invalid_request`: Decryption failure, malformed JSON, or missing required fields.
  - `400 url_blocked`: Non-https scheme (in production) or host resolves to private/loopback/metadata IP.
  - `400 url_too_long`: URL > 2048 chars.
  - `400 method_not_allowed`: Method not in GET/POST/HEAD.
  - `400 header_not_allowed`: Header not in request allowlist, or `Authorization`/`Cookie`.
  - `400 body_too_large`: POST body > 256 KiB.
  - `401 unauthorized`: Missing or invalid Bearer session token.
  - `413 request_too_large`: Encrypted request envelope > `EXTENSION_PROXY_MAX_REQUEST_BYTES`.
  - `501 proxy_disabled`: `EXTENSION_PROXY_ENABLED=false`.
  - `502 fetch_failed`: Outbound connect/read timeout or connection error.
  - `502 upstream_response_too_large`: Decompressed response body > `EXTENSION_PROXY_MAX_RESPONSE_BYTES`.
- **Zero Plaintext Logging Discipline:** Plaintext URLs, hosts, headers, and request/response bodies are never logged or persisted.

## Task 41b — Model Hosting External and Proxy Modes
- **ID:** Task 41b
- **Date:** 2026-10-04
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec / Amendment references:** Amendment 26 (§5.27, §8.1.3, §8.1.4)
- **Mode-Specific Behavior Matrix:**
  | Property / Behavior | `local` | `external` | `proxy` |
  |---|---|---|---|
  | Routes Registered (`/models/...`) | Yes | **No** (404) | Yes |
  | Capabilities Base URLs | `{APP_URL}/models/...` | `{MODEL_EXTERNAL_BASE_URL}/...` | `{APP_URL}/models/...` |
  | `tts_models[]` Source | Local disk manifest | External manifest cache | Local disk manifest |
  | Manifest Source | `{STT/TTS_MODELS_PATH}/manifest.json` | `{MODEL_EXTERNAL_BASE_URL}/manifest.json` | Local disk manifest |
- **External Mode Manifest Cache & TTL:**
  - `{MODEL_EXTERNAL_BASE_URL}/manifest.json` is fetched on first capabilities request after startup (or reload) and cached in memory with a 1-hour TTL (`MANIFEST_TTL = 3600s`).
  - Validation: Parsed manifest is validated against schema v1 (schema_version 1, valid model IDs, version >= 1, file sha256 64 hex, path restrictions).
  - Validation/Network failure during background/reload refresh retains the previous valid cached manifest.
- **Proxy Mode Cache & Atomic Rename Semantics:**
  - Cache Hit: Files existing locally at `{KIND_MODELS_PATH}/{model_id}/{version}/{filename}` are served directly from disk.
  - Cache Miss: Fetches from `{MODEL_EXTERNAL_BASE_URL}/{kind}/v1/{model_id}/{version}/{filename}` using `reqwest` (10s connect, 60s read timeouts) to a temp file in the same directory (`{filename}.tmp.<pid>.<time>`).
  - Verification: Validates total downloaded bytes against `model.files[].size_bytes` and SHA-256 hex string against `model.files[].sha256`. On mismatch or network error, temp file is deleted, failure recorded in a 30-second failure cache, and HTTP 502 `model_fetch_failed` returned (`details.upstream`). On success, temp file is atomically renamed to destination.
  - Range Requests: On cache miss, fetches full file into cache first, then serves HTTP 206 Partial Content from local disk.
- **`POST /admin/models/reload` Behavior:**
  - Local & Proxy: Re-reads local disk manifests atomically.
  - External: Forces re-fetch of `{MODEL_EXTERNAL_BASE_URL}/manifest.json`. Network errors return HTTP 502 `model_fetch_failed`; validation errors return HTTP 400 `invalid_model_manifest`. Previous valid cache is preserved on error.
  - Audit: Writes `model.manifest_reload` audit log with metadata `{ "mode": "<mode>", "stt_models": N, "tts_models": M }`.
- **Operational Note for Proxy Mode:**
  - Adding a model requires updating the local manifest and calling `POST /admin/models/reload` (or letting first client request hit a model already in local manifest).

## Task 39b — CLI Model Subcommands Contract and Semantics
- **ID:** Task 39b
- **Date:** 2026-10-04
- **Status:** Complete. Canonical. Cross-team contract.
- **Spec / Amendment references:** §9, §16.14 (Amendment 26)
- **Subcommands & Usage:**
  - `server models verify [--json] [--kind <stt|tts|all>] [--quiet]`
  - `server models fetch --from <url> [--kind <stt|tts|all>] [--json] [--jobs <N>] [--force]`
- **Exit Code Conventions:**
  - `0`: Success (all files verified / all files fetched or already present).
  - `1`: Negative outcome (one or more files failed verification, missing, size/hash mismatch, or failed download).
  - `2`: Invocation / Usage / Config error (invalid flags, missing/unparseable local manifest, production HTTP `--from` URL, or unreachable base URL on initial connect).
- **Flag Semantics & Rules:**
  - `--from <url>`: Base URL of shared origin (origin root, e.g. `https://models.example.com`). Must not contain kind path `/stt/v1/` or `/tts/v1/` (returns exit code 2 if present). Must use `https://` in production.
  - `--jobs <N>`: Bounded parallel async download concurrency (`1..=8`). Defaults to 1 (sequential).
  - `--force`: Re-downloads model files even if present locally with matching size and SHA-256 hash.
  - `--kind`: Filters model kinds (`stt`, `tts`, `all`, defaulting to `all`).
  - `--json`: Outputs structured JSON report.
  - `--quiet`: Suppresses per-file console output for `verify`.
- **Operational & Storage Invariants:**
  - `verify` is read-only and local (never contacts network or modifies files).
  - `fetch` requires manifests to exist locally prior to invocation (does not fetch manifests from origin).
  - Downloads write to atomic temporary files (`{filename}.tmp.<pid>.<nanos>`) in target model directory, verifying size and SHA-256 before atomic rename to target path.
  - Size mismatch or hash mismatch deletes temporary files without touching target file path.
  - Partial failures in `fetch` are non-atomic (successful file downloads persist and are skipped on subsequent runs).

## OPRF Identity with Token Split Verification Fact
- **ID:** Task OPRF Identity Token Split
- **Date:** 2026-10-05
- **Status:** Complete. Canonical. Client-facing contract.
- **Spec / Amendment references:** V3 Spec §6.19, §6.20, §6.21, §7.1, §8.1.1, §8.2.1, §8.2.2, §8.2.3, §11, §12
- **Wire Contract & Token Split Invariants:**
  - The client derives `token` (64-byte SHA-512 from `OprfClient::finalize()`) and `lookup_token` (`HKDF-Expand(token, "username-lookup-v1", 64)`).
  - The client sends `lookup_token` in the `lookup_token` JSON request field to the server. `token` is never sent to the server. Requests containing a `token` field are rejected with 400 Bad Request or ignored.
  - The server stores `lookup_token` in `users.username_token` (`TEXT NOT NULL UNIQUE`, 86-char base64url).
  - Display name (`encrypted_display`) and device name encryption keys are derived on the client from `token` (not `lookup_token` and not anything the server stores). The server stores `encrypted_display` as opaque ciphertext and never decrypts it.
  - `POST /auth/login/start` returns 200 `{ login_id, credential_response }` for both known and unknown `lookup_token`s using a dummy OPAQUE registration record (`password_file = None`) to prevent enumeration.
  - `POST /users/lookup` rate limiting (`RATE_LOOKUP_PER_MIN`) is the enumeration defense per §12. Timing padding is not applied.

## Task 39a — Capabilities Audit, Consolidated Response Shape, and Disabled-State Invariants
- **ID:** Task 39a
- **Date:** 2026-10-04
- **Status:** Complete. Canonical. Client-facing contract.
- **Spec / Amendment references:** §8.1
- **Canonical Response Key Set (42 Keys):**
  The top-level JSON response object returned by `GET /api/v1/capabilities` contains strictly these 42 keys:
  `version`, `calling`, `call_max_participants`, `sessions_enabled`, `max_sessions_per_room`, `max_session_participants`, `session_types`, `model_hosting_enabled`, `model_hosting_mode`, `stt_models_base_url`, `stt_default_model`, `tts_models_base_url`, `tts_default_model`, `tts_models`, `push_vapid_public_key`, `websocket_url`, `sockudo_app_key`, `sockudo_channel_prefix`, `altcha`, `storage_backend`, `storage_presign_supported`, `storage_presign_max_ttl_seconds`, `attachment_format`, `attachment_chunk_size`, `attachment_bucket_sizes`, `attachment_accept_ranges`, `username_oprf_enabled`, `oprf_suite`, `key_transparency_enabled`, `link_preview_proxy_enabled`, `safety_number_mode`, `moderation_mode`, `edit_window_seconds`, `reactions_per_message`, `sync_event_retention_days`, `threading_enabled`, `starred_items_per_user`, `extension_proxy_enabled`, `extension_proxy_max_request_bytes`, `extension_proxy_max_response_bytes`, `extension_proxy_supports_streaming`, `extension_proxy_key`.
- **Constant Key Set & Disabled-State Invariants:**
  - The key set is constant across all server configurations. Top-level keys are never conditionally omitted when features are disabled (`serde(skip_serializing_if)` is removed).
  - Primary feature flags (`calling`, `sessions_enabled`, `model_hosting_enabled`, `key_transparency_enabled`, `link_preview_proxy_enabled`, `extension_proxy_enabled`, `altcha.enabled`, `username_oprf_enabled`) report `false` when disabled.
  - Secondary limit/configuration fields (e.g. `call_max_participants`, `max_sessions_per_room`, `model_hosting_mode`, `stt_models_base_url`, `edit_window_seconds`) remain present with their server configuration/limit values regardless of primary feature flag state.
  - Array fields (`session_types`, `tts_models`) return `[]` when their respective features are disabled or uninitialized.
  - `push_vapid_public_key` returns `null` when push is disabled or keys are unconfigured.
  - `extension_proxy_key` returns the X25519 public key Base64 string when either extension proxy or link preview proxy is enabled, and returns `null` when both are disabled.
- **Removed Stale Fields:**
  - `push_enabled` (redundant; push configuration status is represented by presence/absence of `push_vapid_public_key`).
  - `sockudo_client_events` (internal publisher config not in §8.1).
  - `link_preview_proxy_key` (superseded by `extension_proxy_key`).
- **Proposed Spec Amendment:**
  - Add `extension_proxy_key` to §8.1's `GET /capabilities` response example as a string (Base64 X25519 public key) or `null`.

## User-Scoped Sync Foundation & Contract Verification Fact
- **ID:** User-Scoped Sync Foundation & Contract
- **Date:** 2026-10-05
- **Status:** Complete. Canonical. Foundation contract.
- **Spec / Amendment references:** V3 Spec §4.5, §6.22, §7.2, §8.2.4, §8.9, §11, §14.5
- **`user_seq` Allocator Contract:**
  - `allocate_user_seq(&mut tx, user_id)` executes an atomic SQL upsert inside the row write transaction (`INSERT INTO user_seq ... ON CONFLICT DO UPDATE ... RETURNING next_seq - 1`).
  - Transactional: if the transaction rolls back, `next_seq` is not updated and no sequence number is consumed.
- **`GET /users/me/sync` Response Envelope (§8.2.4):**
  - Requires Bearer auth.
  - Query parameter `since_seq` (integer >= 0 required; missing, negative, or malformed returns HTTP 400 `invalid_since_seq`).
  - Response carries 5 state array fields (`read_state`, `user_preferences`, `device_state`, `starred_items`, `bot_settings`), `max_seq` (integer), and `full_resync_required` (boolean). `bot_settings` array elements are typed DTO `BotSettingSyncRow` (`bot_id`, `key`, `is_secret`, `value_encrypted_client`, `user_seq`).
  - `max_seq` semantics: equals the user's highest allocated `user_seq` (`next_seq - 1` from `user_seq` table, or `0` if no row exists) or `since_seq` if `since_seq` is higher (defensive against stale client cursors).
  - `full_resync_required` boundary rule: evaluates to `false` for `since_seq == 0`; for `since_seq > 0`, evaluates to `true` when `since_seq` is below the minimum retained `user_seq` across active/tombstoned sync state rows or if state corresponding to `user_seq <= since_seq` is older than the retention window (`sync_event_retention_days`, default 90).
- **`read.sync` Event Payload (§8.9):**
  - Payload published on `private-user-{user_id}` channel contains strictly `{ room_id, last_read_message_id, user_seq }` without `updated_at`.
- **Sync Tombstone Pruning (§4.5):**
  - `SyncPruningJob` registered on the shared hourly cleanup scheduler deletes tombstoned rows (`deleted_at IS NOT NULL` and `deleted_at < datetime('now', '-N days')` where $N =$ `sync_event_retention_days`) from `read_state`, `device_names`, and `starred_items`.

## Sync Pruning and Typed Bot Settings Verification Fact
- **ID:** Task Sync Pruning and Typed Bot Settings
- **Date:** 2026-10-05
- **Status:** Complete. Canonical. Foundation contract.
- **Spec / Amendment references:** V3 Spec §4.5, §6.22, §7.2, §8.2.4, §8.9, §11
- **Verified Facts:**
  - `BotSettingSyncRow` struct exists in `server/src/sync/query.rs` (and re-exported in `server::sync`) with `{ bot_id, key, is_secret: bool, value_encrypted_client, user_seq }`, deriving `Serialize` and `Deserialize`.
  - `SyncResponse.bot_settings` is typed `Vec<BotSettingSyncRow>` and serializes as `[]` in JSON when empty.
  - `read.sync` event published in `server/src/sync/read_state.rs` carries strictly `{ room_id, last_read_message_id, user_seq }` without `updated_at`.
  - `SyncPruningJob` in `server/src/cleanup/sync.rs` runs on the shared hourly scheduler, dynamically checking table and `deleted_at` column existence across all 6 sync tables (`read_state`, `user_preferences`, `user_room_order`, `device_names`, `starred_items`, `bot_settings`).
  - `SyncPruningJob` deletes tombstones older than `sync_event_retention_days` enforcing the defensive `user_seq <= (SELECT next_seq - 1 FROM user_seq WHERE user_id = ...)` invariant while preserving active rows (`deleted_at IS NULL`).

## Sync Pruning Full Coverage Verification Fact
- **ID:** Task Sync Pruning Full Coverage
- **Date:** 2026-10-05
- **Status:** Complete. Canonical. Foundation contract.
- **Spec / Amendment references:** V3 Spec §4.5, §6.22
- **Verified Facts:**
  - `SyncPruningJob` in `server/src/cleanup/sync.rs` iterates all six user-scoped sync tables (`read_state`, `user_preferences`, `user_room_order`, `device_names`, `starred_items`, `bot_settings`).
  - Runtime table existence check (`sqlite_master`) and column check (`pragma_table_info('deleted_at')`) ensure missing tables or tables without `deleted_at` columns are skipped gracefully without error or panic.
  - Before deletion, candidate tombstones older than `sync_event_retention_days` are inspected to verify `user_seq <= (SELECT next_seq - 1 FROM user_seq WHERE user_id = {table}.user_id)`.
  - Anomalous tombstones (`user_seq > max_seq` or missing `user_seq` row) are skipped and logged as `tracing::warn!(table = table, user_id = %user_id, "skipped tombstone violating user_seq invariant")` without exposing row contents or `user_seq` values.
  - Per-table counts are logged at `info`: `tracing::info!(table = table, deleted = rows_deleted, skipped = skipped_count, "pruned tombstones for sync table")`.
  - Job is idempotent across consecutive executions and advances the `full_resync_required` boundary properly.

## Sync Pruning Candidate Pre-inspection and Logging Contract
- **ID:** Task Sync Pruning Candidate Inspection and Skipped Logging
- **Date:** 2026-10-05
- **Status:** Complete. Canonical. Foundation contract.
- **Spec / Amendment references:** V3 Spec §4.5, §5.1
- **Verified Facts:**
  - `SyncPruningJob` pre-inspects candidate tombstones, selecting `rowid`, `user_id`, `user_seq`, and `max_user_seq`.
  - Candidates violating `user_seq <= max_user_seq` or missing `user_seq` row are treated as anomalous, incrementing `skipped` count and emitting `tracing::warn!(table = table, user_id = %user_id, "skipped tombstone violating user_seq invariant")`. The `warn` log includes `table` and `user_id`, and omits `user_seq` or other values.
  - Deletion executes strictly on valid candidate `rowid`s via chunked `DELETE FROM {table} WHERE rowid IN (...)` queries, incrementing `deleted` count.
  - Per-table `info` log `tracing::info!(table = table, deleted = rows_deleted, skipped = skipped_count, "pruned tombstones for sync table")` is emitted after processing each table, even when both counts are 0.

## Sync Pruning Rowid-Scoped Deletion and Missing `user_seq` Row Contract
- **ID:** Task Rowid-Scoped Deletion and Sync Pruning Test Coverage
- **Date:** 2026-10-05
- **Status:** Complete. Canonical. Foundation contract.
- **Spec / Amendment references:** V3 Spec §4.5, §5.1
- **Verified Facts:**
  - Candidate query selects `rowid` along with `user_id`, `user_seq`, and `max_user_seq`.
  - Candidates missing a row in `user_seq` map `max_user_seq` to `None`, resulting in `is_valid = false`; they are treated as anomalous (incrementing `skipped`, emitting `warn` log, excluded from delete).
  - Valid candidates accumulate into `Vec<i64>` during the classification loop; deletion executes strictly via parameterized `DELETE FROM {table} WHERE rowid IN (...)` queries.
  - If no candidates pass validation, deletion is skipped entirely and `deleted = 0`.
  - Comprehensive test suite in `server/tests/cleanup.rs` asserts database retention across single-run, double-run, all-anomalous, missing `user_seq`, and mixed rowid-scoped scenarios.

## Sync Pruning Database-State Test Assertions Contract
- **ID:** Task Sync Pruning Database-State Test Assertions
- **Date:** 2026-10-05
- **Status:** Complete. Canonical. Foundation contract.
- **Spec / Amendment references:** V3 Spec §4.5, §5.1
- **Verified Facts:**
  - All-anomalous tables retain all N rows in the database following job runs without deleting anomalous tombstones or altering other rows for that user.
  - Candidates missing a `user_seq` row are verified to be retained in the database table.
  - Double-run idempotency leaves database table contents identical across consecutive executions.
  - Mixed-case rowid-scoped deletion in a single table deletes strictly valid `rowid`s while leaving anomalous `rowid`s unmutated (`deleted_at` and `user_seq` unchanged).

## Sync Pruning Database-State Test Assertions Precision
- **ID:** Task Sync Pruning Database-State Test Assertions Precision
- **Date:** 2026-10-05
- **Status:** Complete. Canonical. Test-only contract.
- **Spec / Amendment references:** V3 Spec §4.5, §5.1
- **Verified Facts:**
  - `test_13` all-anomalous block verified with set equality and zero unexpected item IDs.
  - `test_13` double-run block verifies cross-table retention (`starred_items`, `device_names`, `read_state`) and unmutated `deleted_at` / `user_seq` for anomalous row `r_mixed2`.
  - `test_14_sync_pruning_rowid_scoped_deletion` verifies 2 valid + 1 anomalous tombstone pruning in `read_state` with exact `deleted=2, skipped=1` log assertion, rowid-scoped deletion, unmutated anomalous row attributes, and second-run idempotency (`deleted=0, skipped=1`).

## Device Model Contract and Endpoint Surface Verification Fact
- **ID:** Task Device Model Contract
- **Date:** 2026-10-05
- **Status:** Complete. Canonical. Foundation contract.
- **Spec / Amendment references:** V3 Spec §6.21, §7.1, §7.2, §8.2, §8.9, §11
- **Verified Facts:**
  - `devices` table schema in `server/migrations/0001_v2_schema.sql` lacks `platform` column and retains legacy `name` column.
  - `device_names` table schema in `server/migrations/0001_v2_schema.sql` matches §7.2 exactly, including `user_seq` and `deleted_at`.
  - Endpoints under `/users/me/devices` are implemented: `GET /users/me/devices` (lists devices), `PATCH /users/me/devices/:id` (updates device encrypted name), and `DELETE /users/me/devices/:id` (revokes device).
  - Write path for device names calls `sync::device_names::write_device_name` from `PATCH /users/me/devices/:id` and `POST /auth/login/finish`.
  - Live user events currently publish non-spec `device.sync` instead of `device.name_updated`, and `device.added` / `device.revoked` are not yet emitted.
  - Sync response `GET /users/me/sync` contains `device_state` array with `DeviceStateRow` items (`device_id`, `encrypted_device_name`, `user_seq`, `updated_at`, `deleted_at`).
  - Device creation occurs during `POST /auth/login/finish` carrying `client_id` (currently missing `platform`).
  - Spec gap resolved with concrete endpoint proposal `PATCH /users/me/devices/:id` sending `{ "encrypted_device_name": "<base64url>" }` returning `DeviceStateRow` and publishing `device.name_updated`.
- **Link to report:** [verification/device-model-contract/report.md](verification/device-model-contract/report.md)

## Device Event Shapes Fact
- **ID:** Task Device Model Implementation Events
- **Date:** 2026-10-05
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §7.1, §8.9
- **Verified Facts:**
  - `device.added`: Published on durable user channel `private-user-{user_id}` when a new device is created during `POST /auth/login/finish`. Payload shape (`device_id`, `platform`, `added_at`, `user_seq`) verified by `test_15_device_added_event_payload_shape` in `server/tests/login.rs`.
  - `device.revoked`: Published on durable user channel `private-user-{user_id}` when a device is revoked via `DELETE /users/me/devices/:id`. Payload shape (`device_id`, `reason == "revoked_by_user"`, `user_seq`) verified by `test_19_device_revoked_event_payload_shape` in `server/tests/devices.rs`.
  - `device.name_updated`: Published on durable user channel `private-user-{user_id}` when a device name is updated via `write_device_name`. Payload shape (`device_id`, `encrypted_device_name`, `user_seq`) verified by `test_20_device_name_updated_event_payload_shape` in `server/tests/devices.rs` (which also asserts zero `device.sync` events published).
  - `device.sync` is no longer published.
  - `user_seq` for each event is allocated inside the same SQL transaction that inserts or mutates state.

## Device Platform and Event Baseline Empirical Verification
- **ID:** Empirical Baseline Device Platform and Events
- **Date:** 2026-10-05
- **Status:** Complete.
- **Spec / Amendment references:** V3 Spec §7.1, §8.2, §8.9
- **Answer found:** Ground truth empirical audit completed. Confirmed `0001_v2_schema.sql` `devices` table schema (`platform` NOT NULL CHECK constraint, `name` absent), `create_device` signature and query, existing `device.added`/`device.revoked`/`device.name_updated` event sites, absence of `device.sync`, test fixture column lists, and absence of V2 remnants. Threaded `platform` through `LoginStartRequest` and `PendingLogin`.
- **Link to report:** [verification/device-platform-and-events/report.md](verification/device-platform-and-events/report.md)

## Device Model Behavioral Contracts Verification
- **ID:** device-contracts-verified
- **Date:** 2026-10-05
- **Status:** Complete.
- **Spec / Amendment references:** V3 Spec §6.21, §6.22, §7.1, §8.2, §8.9, §8.10
- **Question asked:** Does the implementation meet all behavioral contracts for `platform` validation, transaction atomicity for `user_seq`, event publish timing, event payload shapes, sync response contract, and test coverage?
- **Answer found:**
  - **`platform` validation:** Verified at `login_start` (`server/src/routes/login.rs`: lines 104–118). Missing/empty `platform` or unrecognized `platform` strings are rejected with 400 `invalid_platform`. Valid platform strings (`web`, `ios`, `android`, `desktop`) proceed.
  - **`device.added` seq atomicity & timing:** Verified at `login_finish` (`server/src/routes/login.rs`: lines 310–360). `allocate_user_seq` executes inside the `INSERT INTO devices` transaction; publish happens post-commit.
  - **`device.revoked` seq atomicity & timing:** Verified at `revoke_device` (`server/src/devices.rs`: lines 173–247). `allocate_user_seq` executes inside deletion transaction; publish happens post-commit.
  - **`device.name_updated` payload & V2 remnants:** Verified at `write_device_name` (`server/src/sync/device_names.rs`: lines 95–105). Payload matches V3 §8.9 exactly (`device_id`, `encrypted_device_name`, `user_seq`). Zero references to legacy `device.sync`, `devices.name`, or `LoginFinishRequest.platform` exist.
  - **`device_state` sync array:** Verified shape (`device_id`, `encrypted_device_name`, `user_seq`, `updated_at`, `deleted_at`) in `server/src/sync/query.rs` / `device_names.rs`.
  - **Test coverage gaps:** Identified 7 missing test coverage items (event payload assertions for all 3 events, `login_start` missing/invalid platform rejections, and transaction rollback sequence atomicity tests).
- **Link to report:** [verification/device-contracts-verified/report.md](verification/device-contracts-verified/report.md)

## Device Model Test Coverage Empirical Report
- **ID:** device-model-tests-empirical
- **Date:** 2026-10-06
- **Status:** Complete.
- **Spec / Amendment references:** V3 Spec §6.21, §6.22, §7.1, §8.2, §8.9, §8.10
- **Question asked:** What is the repository state across existing device tests, event capture harnesses, login test helpers, transaction rollback patterns, user_seq inspection, batch assignments, and V2 remnants?
- **Answer found:** Verified all existing tests, confirmed Sockudo MockServer harness pattern, documented `login_user` and Axum `oneshot` request helpers, detailed direct `user_seq` query pattern, confirmed batch assignment (`auth` batch for `devices.rs` and `login.rs`), and documented limitation regarding production test hooks for forced rollbacks (leading to `#[ignore]` strategy for tests 6 & 7).
- **Link to report:** [verification/device-model-tests/report.md](verification/device-model-tests/report.md)

## Task 26 — Room Metadata with Encrypted Blob Verification
- **ID:** Task 26 Room Metadata Encrypted
- **Date:** 2026-10-06
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §1.2, §3.2, §4.1, §4.4, §7.4, §8.4, §8.9, §10, §12
- **Question asked:** What is the canonical implementation for room metadata schema, limits, authorization, `metadata_version` increment rules, and `room.updated` event payload?
- **Answer found:**
  - **Schema:** `rooms` table in `server/migrations/0001_v2_schema.sql` contains `metadata` (TEXT) and `metadata_version` (INTEGER NOT NULL DEFAULT 1), matching §7.4.
  - **Limits:** Configured via `SERVER_MAX_ROOM_METADATA_BYTES` (64 KB hard max) and `ROOM_METADATA_MAX_BYTES` (16 KB instance default, range 1 KB – 64 KB).
  - **`metadata_version` Rule:** Increments by 1 on metadata modification only. No-op PATCH with unchanged metadata preserves `metadata_version` without incrementing and skips event emission.
  - **`room.updated` Event Payload:** Carries `{ room_id, metadata }` on `private-room-{room_id}` per §8.9. Best-effort delivery.
  - **Authorization:** `owner` or `moderator` (Discord mode) / `owner` (Messenger mode) per §3.2.
  - **Opacity Invariant:** The server never decrypts or inspects `metadata`. Verbatim ciphertext string roundtrip verified byte-for-byte.
- **Link to report:** [verification/room-metadata-encrypted/report.md](verification/room-metadata-encrypted/report.md)

## Task — Threading V3 Alignment Rules (Phase 9)
- **ID:** Threading V3 Alignment
- **Date:** 2026-10-06
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §1.6, §7.6, §8.5, §8.5.1, §8.9, §10, §11 (Phase 9)
- **Question asked:** What are the canonical reply validation rules, tombstone parent rules, flat parent model rules, edit inheritance rules, and event payloads for message threading (`reply_to`)?
- **Answer found:**
  - **Flat-Parent Model:** Threading model is flat: `reply_to` points to a direct parent message (`"m_..."` or `null`). No `thread_id` or `root_id` columns exist. Reply chains are flat parent pointers; client renders trees if desired. Replying to a reply sets `reply_to` to that reply's ID, not the root's ID.
  - **Cross-Room Rejection:** A `reply_to` referencing a message in a different room is rejected with HTTP 400 `reply_to_not_in_room` (without `details.reason`).
  - **Non-Existent Target Rejection:** A `reply_to` referencing a non-existent message is rejected with HTTP 400 `reply_to_not_found` (without `details.reason`).
  - **Tombstone-Parent Acceptance:** Replying to a tombstoned parent (`deleted_at IS NOT NULL`) in the same room is accepted and succeeds (HTTP 201 Created). Deleting a parent message does not cascade-delete replies.
  - **Any Content Type Acceptance:** Replying to parent messages of any content type (`application`, `commit`, `proposal`, `bot`) in the same room is accepted (HTTP 201 Created).
  - **Edit Inheritance Rule:** When a reply is edited, the new edit row inherits the original message's `reply_to` value in `room_messages`.
  - **`message.edited` Payload:** `message.edited` event payload does NOT carry `reply_to`.
  - **`message.new` Payload:** `message.new` event payload carries `sender_type: "user"`, `sender_id: "u_..."`, `reply_to` (string or `null`), omits `sender_user_id`, and omits `bot_key_leaf_index` per §8.9.
- **Link to report:** [verification/threading-v3/report.md](verification/threading-v3/report.md)

## Task — Member Pagination and Bot Merge (Phase 11)
- **ID:** Member Pagination Bot Merge
- **Date:** 2026-10-06
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §3.2, §3.3, §7.4, §7.10, §8.4, §8.9
- **Question asked:** What is the canonical behavior for merged member list pagination (users and bots) under V3 §8.4?
- **Answer found:**
  - **Empirical Baseline:** Step 0 report generated at `verification/member-pagination-bot-merge/report.md`.
  - **Schema:** Minimal `bot_accounts` and `room_bots` tables added to `server/migrations/0001_v2_schema.sql` along with `idx_room_bots_active` index.
  - **Ordering & Cursor:** Stable ordering and cursor across user and bot entries. All users sort by `user_id ASC`, followed by all active/non-revoked/non-disabled/non-deleted bots sorted by `bot_id ASC`. `MemberCursor` encoded as unpadded base64url JSON carries `room_id`, `last_user_id` or `last_bot_id`, and `segment` (`"users"` or `"bots"`). Cursors missing `segment` default to `segment: "users"` for backward compatibility.
  - **Response Shape:** Matches V3 §8.4 with `type: "user"` (`user_id`, `role`, `joined_at`) or `type: "bot"` (`bot_id`, `mode`, `display_name`, `avatar_file_id`, `joined_at`). V2 remnants (`username_token`, `encrypted_display`, `has_more`) removed.
  - **Exclusions:** Revoked bots (`room_bots.revoked_at IS NOT NULL`), deleted bots (`bot_accounts.deleted_at IS NOT NULL`), and disabled bots (`bot_accounts.disabled_at IS NOT NULL`) are excluded from member lists.
- **Link to report:** [verification/member-pagination-bot-merge/report.md](verification/member-pagination-bot-merge/report.md)

## Whisper Messages Contract & Implementation Verification
- **ID:** Whisper Messages Contract
- **Date:** 2026-10-06
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §7.6, §8.5, §8.5.1, §8.9, §12
- **Question asked:** What are the verified facts for `target_user_ids` validation, storage deduplication, event delivery contracts, non-durability, room channel defensive stripping, and fetch filtering for whisper messages?
- **Answer found:**
  - **Schema:** `target_user_ids TEXT` (nullable) added to `room_messages` in `0001_v2_schema.sql`. Null denotes public message; non-null stores compact JSON array of user IDs without index.
  - **Validation & Deduplication Rules:**
    - Empty array (`"target_user_ids": []`) rejected with HTTP 400 `invalid_target_user_ids`.
    - Target list exceeding effective room size cap rejected with HTTP 400 `target_user_ids_too_large`.
    - Target user not in `room_members` rejected with HTTP 400 `target_not_in_room`.
    - Duplicates in `target_user_ids` are deduplicated preserving the caller's initial order before storage.
  - **Delivery Contract & Event Routing:**
    - Public messages (`target_user_ids` is NULL) publish `message.new` on `private-room-{room_id}` with `target_user_ids: null`.
    - Whisper messages publish events (`message.new`, `message.edited`, `message.deleted`, `reaction.added`, `reaction.removed`) strictly on `private-user-{user_id}` for the recipient set `target_user_ids ∪ {sender_user_id}` (deduplicated). The room channel receives no event for whisper operations.
    - Whisper payloads include `target_user_ids` matching the stored recipient list.
  - **Room Channel Defensive Strip:**
    - `Publisher::publish` defensively inspects payloads published to `private-room-*` channels. If `target_user_ids` is non-null and non-empty, it strips the field before publishing and logs `tracing::warn!(event_name = %event, ...)` without field values or user IDs.
  - **Non-Durability:**
    - Whisper events do not allocate a `user_seq`, do not write to sync tables, and do not appear in `GET /users/me/sync`.
  - **Fetch Filtering Rule:**
    - `GET /rooms/:id/messages` filters whisper rows so they are visible strictly to the sender (`sender_user_id == requester_id`) or recipients (`requester_id` in `target_user_ids`). Non-recipient members do not see whisper rows.
- **Link to report:** [verification/whisper-messages/report.md](verification/whisper-messages/report.md)

## Avatar Upload Opacity & Profile Invariants Verification
- **ID:** Avatar Upload Contracts
- **Date:** 2026-10-07
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §4.1, §6.4, §6.10, §7.7, §8.2.7, §12
- **Question asked:** What are the verified facts for server payload opacity, profile_version non-mutation, cross-user non-leakage, and S3 backend support for `POST /users/me/avatar`?
- **Answer found:**
  - **Server Opacity:** `POST /users/me/avatar` acts as a C2SP opaque byte pipe. Arbitrary bytes that are neither valid C2SP ciphertext nor valid image formats are accepted with HTTP 201 Created and stored without server decryption, validation, or MIME inspection, matching normative V3 §12.
  - **`profile_version` Non-Mutation:** Uploading an avatar does not alter `users.profile`, does not bump `users.profile_version`, and publishes zero `user.updated` or other Sockudo events on any channel.
  - **Cross-User Non-Leakage:** Cross-user endpoints `POST /users/lookup`, `GET /rooms/:id/members`, and `GET /users/me` do not expose or leak the uploader's avatar attachment ID or file ID.
  - **S3 Storage Backend Support:** `POST /users/me/avatar` functions seamlessly under `STORAGE_BACKEND=s3`, writing rows with `storage_backend = 's3'` and issuing S3 `PUT` requests for the attachment key.
- **Link to report:** [verification/avatar-upload-v3/report.md](verification/avatar-upload-v3/report.md)

## Pending MLS Adds Bot Targets & Key Package Extension Verification
- **ID:** Pending MLS Adds Bot Targets
- **Date:** 2026-10-07
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §7.5, §7.10, §8.5, §8.8.5, §8.8.6, §8.9, §11
- **Question asked:** What are the verified facts for `pending_mls_adds` and `key_packages` bot target schema XOR enforcement, `PendingAddView` JSON shape, helper contracts, and event payload structure?
- **Answer found:**
  - **Schema & XOR Enforcement:** Both `pending_mls_adds` and `key_packages` tables in `server/migrations/0001_v2_schema.sql` allow `user_id`/`target_user_id` and `bot_id`/`target_bot_id` to be nullable and enforce XOR `CHECK ((target_user_id IS NOT NULL AND target_bot_id IS NULL) OR (target_user_id IS NULL AND target_bot_id IS NOT NULL))`. Attempting to insert both or neither target produces a database CHECK constraint error.
  - **`PendingAddView` API Response Shape:** `GET /rooms/:id/pending-adds` returns `{"pending_adds": [...]}` with `Cache-Control: no-store`. Both `target_user_id` and `target_bot_id` fields are present in every row item in JSON output (populated as a string for the target identity and `null` for the other).
  - **Helper Contracts:** `queue_pending_mls_add` and `queue_pending_mls_add_batch` in `server/src/rooms.rs` enforce application-level XOR target checks, select and consume non-last-resort (or fallback last-resort) key packages for the target user/bot device, and insert rows into `pending_mls_adds`.
  - **`mls.add_pending` Event Payload Shape:** Published on `private-room-{room_id}` post-commit with shape `{ "room_id": "r_...", "target_user_id": "u_..." | null, "target_bot_id": "b_..." | null, "client_ids": ["c_...", ...] }`.
- **Link to report:** [verification/pending-mls-adds-bot-targets/report.md](verification/pending-mls-adds-bot-targets/report.md)

## Pending MLS Removes Bot Targets & Timeout Verification
- **ID:** Pending MLS Removes Bot Targets & Timeout
- **Date:** 2026-10-07
- **Status:** Empirical Baseline Verified.
- **Spec / Amendment references:** V3 Spec §4.5, §7.5, §8.8.6, §8.8.7, §8.9, §11
- **Question asked:** What are the current baseline state and V3 requirements for `pending_mls_removes` schema, queueing helper, stale timeout job, consumed-row pruning, and event channels/payloads?
- **Answer found:**
  - **Schema:** `pending_mls_removes` table in `server/migrations/0001_v2_schema.sql` updated to match §7.5 with nullable `target_user_id`, `target_bot_id`, XOR `CHECK`, `stale_at`, `consumed_at`, `cancelled_at`, `remove_confirmed_at`, and `idx_pending_mls_removes_active` index (`WHERE consumed_at IS NULL AND cancelled_at IS NULL`).
  - **Queue Helper:** `queue_pending_mls_remove_batch` helper in `server/src/rooms.rs` queues target identity-level removes for `MlsTarget::User` or `MlsTarget::Bot`. Refactored existing call sites in `kick_member`, `revoke_device`, and `anonymise_user`.
  - **Stale Timeout Job:** Hourly cleanup job evaluates rows where `stale_at IS NULL AND remove_confirmed_at IS NULL AND cancelled_at IS NULL AND queued_at < datetime('now', '-N days')` using `PENDING_MLS_REMOVE_TIMEOUT_DAYS` (default 30). Sets `stale_at = now` and emits `mls.remove_stale` once on `private-room-{room_id}` (`{ room_id, target_user_id?, target_bot_id?, queued_at, stale_since }`). Does not re-fire.
  - **Consumed-Row Pruning:** Hourly job prunes rows with `consumed_at < datetime('now', '-30 days')` or `cancelled_at < datetime('now', '-30 days')`.
  - **Event Delivery (`mls.remove_confirmed`):** Emits `{ room_id, target_user_id?, target_bot_id?, confirmed_at }` on `private-room-{room_id}` best-effort, and durable `{ room_id, target_user_id?, target_bot_id?, confirmed_at, user_seq }` on `private-user-{user_id}` channels (target user, confirming member, and bot owner).
- **Link to report:** [verification/pending-mls-removes-bot-targets/report.md](verification/pending-mls-removes-bot-targets/report.md)

## Key Transparency with Bot Keys Empirical Baseline & Bot Leaf Serialization Amendment Proposal
- **ID:** Key Transparency with Bot Keys Empirical Baseline
- **Date:** 2026-10-07
- **Status:** Empirical Baseline Verified & Spec Amendment Proposed.
- **Spec / Amendment references:** V3 Spec §5.22, §7.11, §8.9, §8.11, §12, §14.6
- **Question asked:** What is the current ground truth for `key_transparency_log` schema, leaf serialization, signing key derivation, snapshot signing, `bot_accounts` pubkey columns, and endpoints, and what specification amendment is required for bot leaf serialization?
- **Answer found:**
  - **Schema State:** Current `key_transparency_log` in `server/migrations/0001_v2_schema.sql` lacks `bot_id`, `command_pubkey`, and XOR `CHECK ((user_id IS NOT NULL AND bot_id IS NULL) OR (user_id IS NULL AND bot_id IS NOT NULL))`. `user_id`, `username_token`, and `identity_pubkey` are currently `NOT NULL` in the baseline schema.
  - **`bot_accounts` Schema:** Baseline `bot_accounts` table lacks `bot_identity_pubkey`, `bot_command_pubkey`, and `identity_pubkey`.
  - **Leaf Serialization & Proposed Spec Amendment:** V3 Spec §7.11 defines the log table with bot columns but does not explicitly specify the byte serialization for bot leaves. Following Task 34b user leaf precedent by analogy, the proposed amendment is:
    `serialize_bot_leaf(bot_identity_pubkey, command_pubkey, identity_pubkey) = I2OSP(len(bot_identity_pubkey), 2) || bot_identity_pubkey || I2OSP(len(command_pubkey), 2) || command_pubkey || I2OSP(len(identity_pubkey), 2) || identity_pubkey` where lengths are 16-bit big-endian unsigned integers and string bytes are UTF-8 bytes.
  - **Invariance:** User leaf serialization, leaf hashing (`SHA-256(0x00 || leaf_bytes)`), node hashing (`SHA-256(0x01 || left || right)`), root calculation, signing input (`I2OSP(tree_size, 8) || root_hash`), signing key derivation (`HKDF-Expand(SHA-256(oprf_key_bytes), "key-transparency-signing-v1", 32)`), GDPR anonymization (`user_id -> anon_<32 hex>`), and `kt.snapshot` payload format remain unchanged.
- **Link to report:** [verification/kt-bot-keys/report.md](verification/kt-bot-keys/report.md)

## Key Transparency Schema and User Endpoint Alignment Verification
- **ID:** Key Transparency Schema & User Endpoints
- **Date:** 2026-10-07
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §5.22, §7.11, §8.9, §8.11.1, §8.11.4, §12, §14.6
- **Question asked:** What are the verified schema, endpoint JSON shapes, exclusion rules, and inclusion proof contracts for Key Transparency schema and user-scoped endpoints?
- **Answer found:**
  - **`key_transparency_log` Schema:** `key_transparency_log` in `server/migrations/0001_v2_schema.sql` has nullable `user_id`, `bot_id`, `username_token`, `identity_pubkey`, and `command_pubkey` columns with XOR `CHECK ((user_id IS NOT NULL AND bot_id IS NULL) OR (user_id IS NULL AND bot_id IS NOT NULL))` constraint. Index `idx_kt_bot` is partial (`WHERE bot_id IS NOT NULL`).
  - **`bot_accounts` Schema:** `bot_accounts` in `server/migrations/0001_v2_schema.sql` has nullable `bot_identity_pubkey`, `bot_command_pubkey`, and `identity_pubkey` columns.
  - **`GET /api/v1/kt/user/:id` Endpoint:** Requires Bearer auth (`AuthUser`). Returns `{ "user_id": "...", "leaf_index": <int>, "identity_pubkey": "<base64url>", "inclusion_proof": ["<base64url>", ...], "tree_head": { "tree_size": <int>, "root_hash": "<base64url>", "created_at": "..." }, "auditor_signatures": [] }`. Returns `Cache-Control: no-store`. Returns 404 if disabled or user/leaf missing.
  - **`username_token` Exclusion Invariant:** `username_token` is stored in the database log but is strictly omitted from the `GET /kt/user/:id` JSON response keys per §12 and §14.6 to prevent enumeration.
  - **`GET /api/v1/kt/snapshot` Endpoint:** Requires Bearer auth (`AuthUser`). Returns strictly `{ "tree_size": <int>, "root_hash": "<base64url>", "created_at": "..." }`. Both `signature` and `id` are omitted per §8.11.3. Returns `Cache-Control: no-store`. Returns 404 if disabled or no snapshot exists.
  - **Inclusion Proof Verification:** The $O(\log N)$ inclusion proof in `GET /kt/user/:id` verifies against `tree_head.root_hash` and `tree_head.tree_size` using `verify_inclusion_proof`.

## Link Preview Proxy V3 Alignment Audit
- **ID:** Link Preview Proxy V3 Alignment Audit
- **Date:** 2026-10-08
- **Status:** Step 0 Complete. Case B Identified (Specification Error).
- **Spec / Amendment references:** V3 Spec §2.3, §5.6, §5.23, §6.25, §8.1.2, §12, §14.6
- **Question asked:** What is the ground truth for link preview proxy path, auth, request/response shapes, Content Key mechanism, capability fields, SSRF guard rules, HTML handling, config, rate limiting, and plaintext non-persistence, and how does it compare against V3 §8.1.2?
- **Answer found:**
  - **Classification:** **Case B** — V2 Task 35 fact is canonical and V3 §8.1.2 contains specification errors.
  - **RSA-OAEP Impossibility:** V3 §8.1.2 states `wrapped_content_key: <base64, RSA-OAEP>`. The server has no RSA keypair (all server keys are X25519/Ed25519) and advertises no RSA public key in `GET /capabilities` (§8.1) or anywhere else.
  - **Key Agreement & KDF:** The server implements Ephemeral-Static X25519 ECDH between client's 32-byte ephemeral public key and server's 32-byte static secret key (`LINK_PREVIEW_PROXY_KEY_PATH`), using HKDF-SHA256 with `info = b"link-preview-content-key-v1"` to derive a 32-byte Content Key, and AES-256-GCM encryption with 12-byte random nonce.
  - **Capabilities Public Key:** `GET /capabilities` advertises `extension_proxy_key` (Base64 string of X25519 public key) when link preview proxy or extension proxy is enabled (`link_preview_proxy_key` was removed in Task 39a). Extension Proxy (§8.1.5, Phase 26) reuses this exact X25519 public key.
  - **Auth & Rate Limiting:** Endpoint requires Bearer Auth session token (`AuthUser`). Rate limit `RATE_LINK_PREVIEW_PER_MIN` (default 10) is enforced per user using key `link_preview:{user_id}:min:{boundary}` per V3 §5.6. V3 §8.1.2's claim of "Auth: None. Rate limit: per IP" is a spec error.
  - **Canonical Wire Format (V2 Task 35):**
    - Request: `{ "ephemeral_pubkey": "<base64_32B>", "nonce": "<base64_12B>", "ciphertext": "<base64>" }`
    - Response: `{ "nonce": "<base64_12B>", "ciphertext": "<base64>" }`
  - **SSRF Guard & Plaintext Non-Persistence:** 100% matches V2 Task 35 fact. Plaintext URLs and response bodies are decrypted solely in memory and never logged, audited, or persisted.
  - **Proposed Specification Amendment:** Amend V3 §8.1.2 to align with V2 Task 35 fact (Bearer Auth required, user rate limit key, X25519 ECDH Content Key mechanism, and `ephemeral_pubkey`/`nonce`/`ciphertext` envelope fields).
- **Link to report:** [verification/link-preview-proxy-v3/report.md](verification/link-preview-proxy-v3/report.md)

## Call Signaling Relay Verification Fact (Phase 18)
- **ID:** Phase 18 Call Signaling Relay
- **Date:** 2026-10-08
- **Status:** Complete. Canonical. Client-facing contract.
- **Spec sections affected:** V3 Spec §2.2, §5.6, §6.24, §7.9, §8.7.7, §8.9, §8.10, §12
- **Verified Facts:**
  - **In-Memory Call Occupancy Store:** `CallOccupancyStore` holds call participation purely in memory (`Arc<RwLock<HashMap<call_id, CallOccupancy>>>`). Never persisted to SQLite or disk, never written to log lines, tracing spans, or audit logs. `call_participants` table removed from `0001_v2_schema.sql`.
  - **Signal Endpoint Contract (`POST /api/v1/rooms/:id/calls/:call_id/signal`):**
    - Request: `{ "sender_client_id": "<client_id>", "target_user_id": "<user_id>", "target_client_id": "<client_id>", "envelope": "<base64url>" }`.
    - Response: HTTP 200 OK `{ "delivered_to": 1 }` with `Cache-Control: no-store` header.
    - Validation pipeline:
      1. `CALLING_ENABLED=false` -> HTTP 501 `calling_disabled`.
      2. Room membership check -> HTTP 404 `room_not_found`.
      3. Caller call participation (`is_participant`) -> HTTP 403 `not_a_participant`.
      4. Sender client ownership (`is_client_owner`) -> HTTP 403 `sender_client_not_owned`.
      5. Target client call participation (`find_user_for_client`) -> HTTP 404 `target_not_found`.
      6. Target user matching -> HTTP 400 `target_user_mismatch`.
      7. Envelope base64url decoding -> HTTP 400 `invalid_envelope`.
      8. Rate limit (`RATE_CALL_SIGNAL_PER_MIN`) -> HTTP 429 `rate_limited`.
  - **Event Delivery Contract (`call.signal`):**
    - Published strictly on target user channel `private-user-{target_user_id}`.
    - Payload shape: `{ "call_id": "c_...", "sender_user_id": "u_...", "sender_client_id": "c_...", "target_client_id": "c_...", "envelope": "<base64url>" }`.
    - Non-durable: does NOT allocate a `user_seq`.
    - MUST NOT publish on `private-room-{room_id}` (room channel).
  - **Rate Limiting:** Key format `call_signal:{user_id}:{call_id}:min:{boundary}` (`RATE_CALL_SIGNAL_PER_MIN`, default 120/min). Bucket is per user per call and shared across caller's devices.
  - **No-Persistence & No-Logging Invariants:** Signal relay writes no rows to any table except the rate-limit table, writes zero audit log entries, and logs no field values, usernames, client IDs, or envelope bytes (§12 normative constraint).
- **Link to report:** [verification/call-signaling-user-channel/report.md](verification/call-signaling-user-channel/report.md)

## Call Join, Leave, and End Lifecycle Verification Fact (Phase 19)
- **ID:** Phase 19 Call Join, Leave, and End Lifecycle
- **Date:** 2026-10-08
- **Status:** Complete. Canonical. Client-facing contract.
- **Spec sections affected:** V3 Spec §2.2, §6.24, §7.9, §8.7.5, §8.7.6, §8.7.8, §8.9, §12, §14.8
- **Verified Facts:**
  - **Join Endpoint (`POST /api/v1/rooms/:id/calls/:call_id/join`):**
    - Request: `{ "client_id": "<client_id>" }`.
    - Validates `CALLING_ENABLED` (HTTP 501 `calling_disabled` if false), room membership (HTTP 404 `room_not_found` if not member), `client_id` ownership (HTTP 403 `client_not_owned` if not owned).
    - Session handling: Transactionally creates `call_sessions` row on first join (`initiator_id = caller`, `started_at = CURRENT_TIMESTAMP`, `ended_at = NULL`). Re-joining an ended call returns HTTP 409 `call_ended`.
    - Occupancy & Cap Enforcement: Adds client to `CallOccupancyStore`. Evaluates effective `call_max_participants` limit (`limits::get_limits`). If participant count exceeds limit, removes just-added client and returns HTTP 409 `call_full`.
    - Events & Audit: On first join only, publishes best-effort `call.started` (`{ "call_id": "c_...", "room_id": "r_...", "initiator_id": "u_...", "started_at": "..." }`) on `private-room-{room_id}` and writes `call.start` audit entry. Re-joins emit no events or audit rows.
    - Response: HTTP 200 OK `{ "ice_servers": [] }` with `Cache-Control: no-store` header.
  - **Leave Endpoint (`POST /api/v1/rooms/:id/calls/:call_id/leave`):**
    - Request: `{ "client_id": "<client_id>" }`.
    - Validates `CALLING_ENABLED`, room membership, and caller device ownership of `client_id`.
    - Removes specified client from `CallOccupancyStore`. Clears call from store if participant count becomes 0 (does not set `ended_at`).
    - Response: HTTP 204 No Content with `Cache-Control: no-store` header.
  - **End Endpoint (`POST /api/v1/rooms/:id/calls/:call_id/end`):**
    - Validates `CALLING_ENABLED` and room membership.
    - Authorization: Requires caller to be call initiator (`call_sessions.initiator_id`) or room owner (`rooms.owner_id`). Non-initiator, non-owner members receive HTTP 403 `forbidden`.
    - Updates `call_sessions.ended_at = CURRENT_TIMESTAMP` and clears call occupancy store.
    - Events & Audit: On first end, calculates `duration_seconds = (ended_at - started_at).num_seconds()` and publishes best-effort `call.ended` (`{ "call_id": "c_...", "room_id": "r_...", "ended_at": "...", "duration_seconds": <int> }`) on `private-room-{room_id}` and writes `call.end` audit entry.
    - Idempotency: Re-ending an already-ended call returns HTTP 200 OK with existing session state without re-writing `ended_at`, re-publishing `call.ended`, or re-writing audit logs.
  - **No-Persistence & No-Logging Invariants (§12):** Occupancy is held strictly in-memory (`CallOccupancyStore`). No participant rows are written to SQLite, logs, tracing spans, or metrics.
- **Link to report:** [verification/call-join-leave-end/report.md](verification/call-join-leave-end/report.md)
