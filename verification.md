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
