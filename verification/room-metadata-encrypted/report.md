# Empirical Verification Report — Room Metadata with Encrypted Blob

**Task:** Phase 6 — Room Metadata with Encrypted Blob
**Date:** 2026-10-06
**Status:** Verification Complete — Ground Truth Established

---

## 1. Current `rooms` Table Schema

The exact `CREATE TABLE` statement from `server/migrations/0001_v2_schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS rooms (
    id                  TEXT PRIMARY KEY,
    owner_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    retention_days      INTEGER,
    max_file_size_bytes INTEGER,
    moderation_override TEXT,
    metadata            TEXT,
    metadata_version    INTEGER NOT NULL DEFAULT 1,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**Field verification against §7.4:**
- `metadata` (TEXT, nullable): Present.
- `metadata_version` (INTEGER NOT NULL DEFAULT 1): Present.
- `owner_id`, `retention_days`, `max_file_size_bytes`, `moderation_override`, `created_at`: Present.
- Columns `sessions_per_room`, `bots_per_room`, `pending_mls_removes_per_room`, `call_active`, `call_participants` listed in §7.4 are out of scope for Phase 6 as specified in the task prompt ("Do not touch call_active or call_participants...").

---

## 2. Current `PATCH /rooms/:id` Handler

- **Path:** `PATCH /api/v1/rooms/:id` registered in `server/src/lib.rs` and handled by `update_metadata` in `server/src/routes/rooms.rs`.
- **Request Shape:**
  Accepts raw JSON object body containing optional `metadata`:
  ```json
  { "metadata": "<base64url or null>" }
  ```
- **Response Shape (Current):**
  Currently returns `RoomMetadataResult`:
  ```json
  {
    "room_id": "r_...",
    "metadata": "<base64url or null>",
    "metadata_version": 2,
    "updated_at": "2026-10-06T00:00:00Z"
  }
  ```
  *Note:* §8.4 specifies response as:
  ```json
  {
    "room_id": "r_...",
    "metadata": "<base64url or null>",
    "metadata_version": 2
  }
  ```
- **Current Acceptance:** Accepts `metadata`.

---

## 3. Current `GET /rooms/:id` Handler

- **Path:** `GET /api/v1/rooms/:id` handled by `rooms::get` in `server/src/routes/rooms.rs`.
- **Response Shape:** Returns `RoomWithRole`:
  ```json
  {
    "id": "r_...",
    "owner_id": "u_...",
    "metadata": "<base64url or null>",
    "metadata_version": 1,
    "retention_days": null,
    "max_file_size_bytes": null,
    "moderation_override": null,
    "created_at": "2026-10-06T00:00:00Z",
    "current_user_role": "owner",
    "member_count": 1,
    "effective_max_file_size_bytes": 104857600,
    "effective_message_retention_days": 0
  }
  ```
- **Confirmation:** Returns `metadata`, `metadata_version`, `effective_max_file_size_bytes`, and `effective_message_retention_days` per §4.4.

---

## 4. Current `room.updated` Event

- **Publisher Location:** `update_room_metadata` in `server/src/rooms.rs`.
- **Current Event Name:** `"room.updated"`.
- **Current Channel:** `"private-room-{room_id}"`.
- **Current Payload:**
  ```json
  {
    "room_id": "r_...",
    "metadata_version": 2
  }
  ```
- **Comparison Against §8.9 & Deliverable 6:**
  §8.9 defines `room.updated` as carrying `{ room_id, metadata?, retention_days?, max_file_size_bytes? }`.
  Deliverable 6 requires publishing `{ "room_id": "r_...", "metadata": "<base64url>" }` (or `metadata: null` when cleared). Currently `metadata` is missing from the event payload and `metadata_version` is published instead. The payload will be updated to carry `metadata`.

---

## 5. Current Metadata Validation

- **Current Implementation (`server/src/rooms.rs`):**
  Function `validate_metadata_blob` decodes unpadded base64url (`URL_SAFE_NO_PAD`) or padded base64url (`URL_SAFE`) and verifies that decoded length $\le \text{max\_bytes}$.
  - Invalid base64url returns `RoomMetadataError::InvalidEncoding` -> HTTP 400 `invalid_metadata`.
  - Decoded length exceeding max returns `RoomMetadataError::TooLarge` -> HTTP 413 `metadata_too_large`.
- **Metadata Size Limit Choice & Config Justification:**
  - **Server Hard Max:** 64 KB (65,536 bytes) -> `SERVER_MAX_ROOM_METADATA_BYTES` (env var `SERVER_MAX_ROOM_METADATA_BYTES`, default 65536) in `ServerHardMax`.
  - **Instance Default:** 16 KB (16,384 bytes) -> `ROOM_METADATA_MAX_BYTES` (env var `ROOM_METADATA_MAX_BYTES`, default 16384).
  - **Instance Range:** 1 KB (1,024 bytes) – 64 KB (65,536 bytes).
  - **Justification:** §4.2 does not specify a room metadata limit. Following the pattern of `message_size_bytes` (three-tier model: hard max + instance default + range), an instance default of 16 KB and hard max of 64 KB provides ample headroom for client-encrypted room envelopes (room name, topic, avatar references, extension state) while bounding database memory usage.

---

## 6. Current `metadata_version` Handling

- **Database State:** `metadata_version INTEGER NOT NULL DEFAULT 1` exists on `rooms` table.
- **Current Logic:** `update_room_metadata` currently executes `UPDATE rooms SET metadata = ?, metadata_version = metadata_version + 1 WHERE id = ?` unconditionally on every `PATCH /rooms/:id`.
- **Identified Gap / Flaw:** Currently, `metadata_version` increments even when the supplied `metadata` value is identical to the current value in the database.
- **Required Behavior:** §7.4, Requirement 5, and Deliverable 6 require that `metadata_version` increments **on change only**. If `PATCH /rooms/:id` is called with an unchanged `metadata` value, `metadata_version` MUST NOT increment and `room.updated` MUST NOT be published.

---

## 7. Current `effective_max_file_size_bytes` and `effective_message_retention_days`

- **Functions:**
  - `rooms::effective_file_size_limit(room_override, instance_limit, server_max)`
  - `rooms::effective_message_retention_days(room_override, instance_limit, server_max)`
- **Three-Tier Resolution (§4.1 & §4.4):**
  1. Per-entity override (`rooms.max_file_size_bytes` / `rooms.retention_days`)
  2. Instance default (`instance_limits` table / `limits::get_limits`)
  3. Server hard max (`ServerHardMax`)
- **Presence:** Both fields are always present on `GET /rooms/:id`.

---

## 8. Current Room Channel Publishing

- **Publisher Mechanism:** `state.publisher.publish(&channel, "room.updated", payload)` on `private-room-{room_id}` in `update_room_metadata`.
- **Current Behavior:** Already publishes `room.updated`, but currently sends `metadata_version` instead of `metadata`.
- **Durability:** Best-effort on the room channel per §8.9. Not published on user channels.

---

## 9. Current Room Role Enforcement

- **Current Implementation:**
  `update_room_metadata` in `server/src/rooms.rs` contains:
  ```rust
  if role != "owner" {
      return Err(RoomMetadataError::Forbidden);
  }
  ```
- **Comparison Against §3.2 & Deliverable 4:**
  §3.2 requires `owner` or `moderator` in Discord mode, and `owner` in Messenger mode.
  Currently, `update_room_metadata` does not accept or inspect `moderation_mode` and forbids moderators even in Discord mode.
  - **Gap to Fix:** Thread `moderation_mode` into `update_room_metadata` and permit `moderator` role when `moderation_mode == "discord"`. In Messenger mode or for `member` role, return 403 `forbidden` (or 404 for non-members).

---

## 10. Existing Tests

- `server/tests/room_metadata_write.rs`
- `server/tests/room_metadata_events.rs`
- `server/tests/room_metadata_validation.rs`
- **Batch Assignment:** All 3 files are registered under the `messaging` batch in `server/tests/batch-manifest.toml`.

---

## 11. V2 Remnants

- No legacy `rooms.name` or `name_encrypted` column exists (consolidation in `0001_v2_schema.sql` was verified).
- `rooms.metadata` is treated strictly as an opaque ciphertext blob.

---

## Summary of Actionable Changes Needed

1. **Size Limit Configuration:**
   - Add `SERVER_MAX_ROOM_METADATA_BYTES` (64,536 B hard max) to `ServerHardMax` and `ROOM_METADATA_MAX_BYTES` (16,384 B instance default, range 1,024 – 65,536 B) to `Config` / `InstanceLimits`.
2. **Authorization Fix (§3.2):**
   - Update `update_room_metadata` to allow `moderator` in Discord mode (`moderation_mode == "discord"`).
3. **No-Op PATCH & `metadata_version` Invariant (§7.4):**
   - Check if new `metadata` matches current database `metadata`.
   - If unchanged, return current `RoomMetadataResult` without bumping `metadata_version` and without publishing `room.updated`.
4. **`room.updated` Event Payload Alignment (§8.9):**
   - Change event payload from `{ "room_id": ..., "metadata_version": ... }` to `{ "room_id": ..., "metadata": ... }`.
5. **Comprehensive Tests:**
   - Add/update tests covering unchanged metadata no-op, Discord mode moderator success / non-owner non-moderator 403, Messenger mode non-owner 403, effective limits 3-tier resolution, non-decryption byte-for-byte roundtrip, cross-room isolation, and non-user-channel publishing.
