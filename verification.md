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
