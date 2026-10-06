# Empirical Verification Report: Message Editing V3 Alignment

**Date:** 2026-10-06
**Task:** Verify Message Editing Contract and Close Gaps (Phase 7 of §11)
**Spec References:** Server Specification v3.0.3 §1.2, §3.2, §4.2, §5.5, §7.6, §8.5, §8.5.1, §8.9, §10, §12

---

## 1. Current `room_messages` Schema

Exact `CREATE TABLE` in `server/migrations/0001_v2_schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS room_messages (
    id               TEXT PRIMARY KEY,
    room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sender_user_id   TEXT NOT NULL REFERENCES users(id),
    sender_client_id TEXT NOT NULL,
    epoch            INTEGER NOT NULL,
    seq              INTEGER NOT NULL,
    content_type     TEXT NOT NULL CHECK(content_type IN ('application', 'commit', 'proposal')),
    ciphertext       BLOB NOT NULL,
    deleted_at       DATETIME,
    edit_of          TEXT REFERENCES room_messages(id),
    edit_sequence    INTEGER NOT NULL DEFAULT 0,
    edited_at        DATETIME,
    reply_to         TEXT REFERENCES room_messages(id),
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_room_messages_edit_of ON room_messages(edit_of) WHERE edit_of IS NOT NULL;
```

- **`edit_of`**: `TEXT REFERENCES room_messages(id)` (nullable) — **Confirmed present**.
- **`edit_sequence`**: `INTEGER NOT NULL DEFAULT 0` — **Confirmed present**.
- **`edited_at`**: `DATETIME` (nullable) — **Confirmed present**.
- **Partial index**: `idx_room_messages_edit_of ON room_messages(edit_of) WHERE edit_of IS NOT NULL` — **Confirmed present**.

---

## 2. Current `PATCH /rooms/:id/messages/:msg_id` Handler

- **Path**: `/api/v1/rooms/:id/messages/:msg_id`
- **Auth**: `AuthUser` Bearer session token required.
- **Request Shape**: `EditMessageRequest { ciphertext: Option<String>, sender_client_id: Option<String> }`
- **Response Shape**: Currently returns HTTP 200 OK with `EditResult { edit_id, original_id, edit_sequence, epoch, created_at }`.
- **Gaps identified**:
  - Request body should accept `ciphertext` and optional `content_type` ("application" | "bot").
  - Response status should be `201 Created` returning the new edit row in the same shape as `GET /rooms/:id/messages`.

---

## 3. Current Edit Logic

- Implemented in `server/src/room_messages.rs` (`edit_message`).
- Creates a new `room_messages` row with:
  - `id` = new ULID
  - `edit_of` = `original_id`
  - `edit_sequence` = `current_max + 1`
  - `edited_at` = NULL on the edit row itself (sets `edited_at = CURRENT_TIMESTAMP` on original row if `edited_at IS NULL`)
  - `epoch` = `original_epoch`
  - `content_type` = `'application'`
  - `ciphertext` = `new_ciphertext`
- **Original row preserved**: The original row remains in `room_messages` untouched except setting `edited_at` timestamp on first edit.

---

## 4. Current Edit Window Enforcement

- Resolved from `state.config.edit_window_seconds` (loaded from `EDIT_WINDOW_SECONDS` env var, defaulting to 900).
- Comparison: `elapsed = (now - original.created_at).num_seconds()`. Checked against original message's `created_at`.
- Expiry error: Returns `RoomMessageError::WindowExpired`, mapped in route to `ApiError::InternalWithDetails(StatusCode::FORBIDDEN, "edit_window_expired", ...)` (HTTP 403 `edit_window_expired`).
- **Gaps identified**:
  - `SERVER_MAX_EDIT_WINDOW_SECONDS` (server hard max, default 86400) is not yet in `server/src/config.rs`.
  - `EDIT_WINDOW_SECONDS` is not currently validated against range 60–86400 at startup.

---

## 5. Current Authorization

- Verifies requester is a room member (`room_members`).
- Verifies original message `sender_user_id == requester_user_id`. Non-senders return HTTP 403 `forbidden`.
- Non-members return HTTP 404 `room_not_found` (or 403 `not_a_member`).
- Bots/user distinction: currently checks user sender. Bot editing will be handled under bot tasks (Phase 27+).

---

## 6. Current `message.edited` Event

- Published in `server/src/routes/room_messages.rs` after successful edit.
- Channel: `private-room-{room_id}`
- Current Payload:
  ```json
  {
    "edit_id": "<edit_id>",
    "original_id": "<original_id>",
    "edit_sequence": 1,
    "created_at": "<iso8601>"
  }
  ```
- **Gaps identified**: Does not match V3 §8.9 required payload shape:
  ```json
  {
    "id": "<new_row_id>",
    "edit_of": "<original_id>",
    "edit_sequence": 1,
    "room_id": "r_...",
    "sender_type": "user" | "bot",
    "sender_id": "u_...",
    "created_at": "..."
  }
  ```

---

## 7. Current Edit in `GET /rooms/:id/messages`

- `list_messages` in `server/src/room_messages.rs` returns `RoomMessageView` including `edit_of`, `edit_sequence`, and `edited_at`.
- Both original rows and edit rows are returned in the message list. Clients assemble the chain via `edit_of`.

---

## 8. Current `edit_window_seconds` Config

- `EDIT_WINDOW_SECONDS` read in `server/src/config.rs`, defaults to 900.
- `SERVER_MAX_EDIT_WINDOW_SECONDS` is missing.
- **Gaps identified**: Add `SERVER_MAX_EDIT_WINDOW_SECONDS` (hard max, default 86400) and enforce `60 <= EDIT_WINDOW_SECONDS <= SERVER_MAX_EDIT_WINDOW_SECONDS` at startup.

---

## 9. Current `content_type` for Edits

- Currently hardcoded to `'application'` when inserting an edit row.
- Per V3 §8.5, request body specifies `"content_type": "application" | "bot"`. The edit row uses the `content_type` from the request (or falls back to original message's `content_type`).

---

## 10. Current Tombstone Interaction

- Editing a message with `deleted_at IS NOT NULL` returns `RoomMessageError::EditDeleted`.
- Mapped to HTTP 409 `message_deleted` (`{"error": "message_deleted"}`).

---

## 11. Existing Tests

All existing edit tests live in the `messaging` batch in `server/tests/batch-manifest.toml`:
1. `server/tests/message_edit_write.rs`
2. `server/tests/message_edit_validation.rs`
3. `server/tests/message_edit_events.rs`

---

## 12. V2 Remnants & Gaps

1. **Edits of Edits (Nested Chains)**: `edit_message` currently allows editing an edit row directly, producing a nested chain (`edit_of` = `edit_id`). V3 §8.5 strictly prohibits chaining edits off other edits. If target message has `edit_of IS NOT NULL`, the edit MUST be rejected with HTTP 400/409 (`cannot_edit_edit`).
2. **`message.edited` Payload Gap**: Current event payload uses `edit_id` and `original_id` instead of `id`, `edit_of`, `room_id`, `sender_type`, `sender_id`.
3. **Response Status & Shape Gap**: `PATCH /rooms/:id/messages/:msg_id` currently returns HTTP 200 with `EditResult`. V3 §8.5 requires `201 Created` with full message row shape.
4. **Config Gap**: `SERVER_MAX_EDIT_WINDOW_SECONDS` missing; range validation 60–86400 missing.
5. **Whisper Stub Gap**: Needs Phase 10 comment at event publish site.
