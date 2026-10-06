# Step 0 — Empirical Verification Report: Reactions V3 Alignment

**Date:** 2026-10-06
**Scope:** Phase 8 (§11) — Reactions V3 Alignment

---

### 1. Current `reactions` Table Schema

The exact `CREATE TABLE` statement in `server/migrations/0001_v2_schema.sql` is:

```sql
CREATE TABLE IF NOT EXISTS reactions (
    id               TEXT PRIMARY KEY,
    room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    message_id       TEXT NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
    sender_user_id   TEXT NOT NULL REFERENCES users(id),
    sender_client_id TEXT NOT NULL,
    reaction         TEXT NOT NULL,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at       DATETIME,
    UNIQUE (message_id, sender_user_id, sender_client_id, reaction)
);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reactions_room ON reactions(room_id, created_at DESC);
```

**Comparison with V3 §7.6:**
- Column names, types, foreign key constraints (`ON DELETE CASCADE` for `rooms` and `room_messages`), and defaults match §7.6 exactly.
- `UNIQUE (message_id, sender_user_id, sender_client_id, reaction)` constraint is present.
- Partial index `idx_reactions_message ON reactions(message_id) WHERE deleted_at IS NULL` is present.
- Index `idx_reactions_room ON reactions(room_id, created_at DESC)` is present.

---

### 2. Current `POST /rooms/:id/messages/:msg_id/reactions` Handler

- **Path:** `/rooms/{id}/messages/{message_id}/reactions`
- **Auth:** `AuthUser` bearer token required.
- **Request Shape:**
  ```json
  {
    "reaction": "Option<String>",
    "client_id": "Option<String>"
  }
  ```
- **Response Shape:**
  ```json
  {
    "id": "...",
    "message_id": "...",
    "reaction": "...",
    "created_at": "..."
  }
  ```
- **Status Codes:**
  - `200 OK` on successful add or re-add.
  - `409 Conflict` (`already_reacted`) on duplicate add of active reaction.
  - `409 Conflict` (`reaction_limit_reached`) when per-message reaction limit is reached.
  - `404 Not Found` (`room_not_found` or `message_not_found`).
  - `400 Bad Request` on invalid reaction string or missing fields.

---

### 3. Current `DELETE /rooms/:id/messages/:msg_id/reactions/:reaction_id` Handler

- **Current Path:** `/rooms/{id}/messages/{message_id}/reactions/{reaction}` (Note: path parameter is currently the reaction emoji/string, not `reaction_id`!).
- **Auth:** `AuthUser` bearer token required.
- **Request Query:** `?client_id=<client_id>` required in query string.
- **Response:** `204 No Content`.
- **Logic:** Looks up active reaction row by `(message_id, sender_user_id, client_id, reaction)` and soft-deletes it (`UPDATE reactions SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`).
- **Gap:** Path must be `/rooms/:id/messages/:msg_id/reactions/:reaction_id` per §8.5, operating on reaction row primary key `id` rather than reaction emoji string + `client_id` query param.

---

### 4. Current Reaction Add Logic

- **Upsert / Repeat Add Handling:**
  - Currently checks `SELECT id, deleted_at FROM reactions WHERE message_id = ? AND sender_user_id = ? AND sender_client_id = ? AND reaction = ?`.
  - If active row exists (`deleted_at IS NULL`), returns `ReactionError::AlreadyExists`, which mapped to HTTP 409 `already_reacted`.
  - If tombstoned row exists (`deleted_at IS NOT NULL`), reactivates by setting `deleted_at = NULL` and updating `created_at = CURRENT_TIMESTAMP`.
- **V3 Gap:** Repeat add of an active reaction MUST be idempotent and return HTTP 200 with the existing row rather than 409 Conflict. Re-adding a tombstoned reaction MUST clear `deleted_at`, preserve `id`, and return HTTP 201 Created.

---

### 5. Current Reaction Remove Logic

- **Tombstone vs Hard Delete:** Soft-deletes row by setting `deleted_at = CURRENT_TIMESTAMP`. Does not hard-delete.
- **Alignment:** Soft-delete behavior matches §7.6 and partial index expectations.

---

### 6. Current `reactions_per_message` Enforcement

- Counts active reactions (`WHERE deleted_at IS NULL`) on the message. Rejects if `active_count >= limit` with HTTP 409 `reaction_limit_reached`.
- **Config & Limit Model:**
  - `SERVER_MAX_REACTIONS_PER_MESSAGE` (hard max, default 50) is defined in `config.rs`.
  - Instance limit `reactions_per_message` (default 50) resolved in `limits.rs`.
  - Range 1–50 enforced.

---

### 7. Current Rate Limit

- `RATE_REACTION_PER_MIN` (default 60) enforced in `config.rs` and `rate_limit.rs`.
- Key format: `reaction:{user_id}:min:{boundary}`.
- **Gap:** Currently enforced on BOTH add and remove endpoints in `routes/reactions.rs`. Per V3 spec, the rate limit must apply to the ADD endpoint only. Delete is a removal and must not be throttled by this rate limit key.

---

### 8. Current `reaction.added` Event

- **Channel:** `private-room-{room_id}`.
- **Current Payload:**
  ```json
  {
    "reaction_id": "...",
    "message_id": "...",
    "user_id": "...",
    "client_id": "...",
    "reaction": "...",
    "created_at": "..."
  }
  ```
- **V3 §8.9 Contract:**
  ```json
  {
    "id": "...",
    "room_id": "r_...",
    "message_id": "m_...",
    "sender_user_id": "u_...",
    "reaction": "...",
    "created_at": "..."
  }
  ```
- **Gaps:** Key `reaction_id` must be `id`; key `user_id` must be `sender_user_id`; `room_id` is missing; extra `client_id` must be removed.

---

### 9. Current `reaction.removed` Event

- **Channel:** `private-room-{room_id}`.
- **Current Payload:**
  ```json
  {
    "reaction_id": "...",
    "message_id": "...",
    "user_id": "...",
    "client_id": "...",
    "reaction": "..."
  }
  ```
- **V3 §8.9 Contract:**
  ```json
  {
    "id": "...",
    "room_id": "r_...",
    "message_id": "m_..."
  }
  ```
- **Gaps:** Key `reaction_id` must be `id`; `room_id` is missing; extra fields (`user_id`, `client_id`, `reaction`) must be removed.

---

### 10. Current Tombstone Interaction

- Currently, `add_reaction` verifies message existence using `WHERE id = ? AND room_id = ? AND deleted_at IS NULL`.
- If parent message is tombstoned (`deleted_at IS NOT NULL`), adding a reaction returns 404 `message_not_found`.
- **V3 §7.6 Requirement:** Adding or removing a reaction on a tombstoned message MUST be accepted and publish `reaction.added`/`reaction.removed`. Clients filter locally. The message existence check must ignore `deleted_at IS NOT NULL` on `room_messages`.

---

### 11. Current Reaction Delivery for Whispers

- Currently, reaction events do not check if the parent message is a whisper and always publish to `private-room-{room_id}`.
- **Phase 10 Scope:** Whisper reaction routing belongs to Phase 10.
- **Action:** Add stub comment at both publish sites noting Phase 10 routing requirements per §8.9.

---

### 12. Current Visibility in `GET /rooms/:id/messages`

- Currently, `RoomMessageView` in `room_messages.rs` includes `reactions: Vec<ReactionSummary>`, populated by `list_reactions_for_messages`.
- **V3 Alignment:** §8.5.1 does not list a `reactions` field on the message fetch shape. Per task instructions, no changes are made to `GET /rooms/:id/messages` shape in this task; relationship is recorded.

---

### 13. Existing Tests

All reaction tests reside in `server/tests/`:
- `reaction_events.rs`
- `reaction_list.rs`
- `reaction_validation.rs`
- `reaction_write.rs`

**Batch Assignment:** Registered in `server/tests/batch-manifest.toml` under the `test-messaging` batch (`make test-messaging`).

---

### 14. V2 Remnants to Remediate

1. Route path for delete uses `/rooms/:id/messages/:msg_id/reactions/:reaction` instead of `/rooms/:id/messages/:msg_id/reactions/:reaction_id`.
2. Delete route requires `client_id` query param and reaction string in path instead of reaction row `id`.
3. Add endpoint returns 409 Conflict on repeat add instead of idempotent 200 OK with existing row.
4. Add endpoint returns 404 MessageNotFound on tombstoned messages instead of allowing reactions.
5. Delete endpoint applies `RATE_REACTION_PER_MIN` rate limiting.
6. Event payloads for `reaction.added` and `reaction.removed` mismatch §8.9 field names and structures.
7. Authorization for delete does not support room owners / moderators removing reactions on messages in their rooms.
8. Status code for fresh add / re-add is 200 OK instead of 201 Created.

---

### Summary of Required Changes

1. **Schema Check:** Confirm `0001_v2_schema.sql` matches §7.6.
2. **Endpoints & Routing:**
   - Update `POST /rooms/:id/messages/:msg_id/reactions` body shape to accept `sender_client_id` (or `client_id` fallback) or derive from auth context. Returns 201 Created on create/reactivate, 200 OK on idempotent repeat.
   - Update `DELETE /rooms/:id/messages/:msg_id/reactions/:reaction_id` path and handler to delete by reaction primary key `id`. Sender or room owner/moderator may delete.
3. **Database Operations:**
   - Update `add_reaction` to allow reactions on tombstoned parent messages.
   - Update `add_reaction` to return idempotent active row rather than `AlreadyExists` error.
   - Update `remove_reaction` to allow removals on tombstoned parent messages and verify caller is reaction sender OR room owner/moderator.
4. **Events:**
   - Align `reaction.added` payload: `{ id, room_id, message_id, sender_user_id, reaction, created_at }`.
   - Align `reaction.removed` payload: `{ id, room_id, message_id }`.
   - Add Phase 10 whisper stub comments at both publish sites.
5. **Rate Limiting:** Remove rate limit check from reaction DELETE route.
6. **Tests & Ledger:** Update/add tests in `reaction_*.rs` and update `task-ledger.md` and `verification.md`.
