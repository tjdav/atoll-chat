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

## Task 26 — Room Metadata Schema Migration
- **ID:** Task 26
- **Date:** 2026-10-02
- **Status:** Complete.
- **Spec sections affected:** §2.4, §7.4
- **Question asked:** What was the initial schema state of the `rooms` table prior to migration 0026?
- **Answer found:** Case A — `rooms` contained `name_encrypted` (TEXT) and lacked `metadata` or `metadata_version`. Migration `0026_rooms_metadata.sql` added `metadata` (TEXT), added `metadata_version` (INTEGER NOT NULL DEFAULT 1), and dropped `name_encrypted`.

## Task 28 — Message Reactions Schema & Unique Constraint
- **ID:** Task 28
- **Date:** 2026-10-02
- **Status:** Complete.
- **Spec sections affected:** §2.1, §4.2, §5.6, §7.6, §8.5, §8.8, §14.8
- **Question asked:** What was the initial schema state of the `reactions` table prior to migration 0028?
- **Answer found:** Case A — `reactions` table did not exist. Migration `0028_reactions.sql` created the `reactions` table with composite `UNIQUE (message_id, sender_user_id, sender_client_id, reaction)` and partial index on `reactions(message_id) WHERE deleted_at IS NULL`.

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
