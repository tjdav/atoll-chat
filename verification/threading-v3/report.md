# Empirical Verification Report: Threading V3 Alignment (Phase 9)

**Date:** October 2026
**Status:** Completed

---

## 1. Current `room_messages` Schema

Exact `CREATE TABLE` statement in `server/migrations/0001_v2_schema.sql` (lines 154–168):

```sql
CREATE TABLE IF NOT EXISTS room_messages (
    id               TEXT PRIMARY KEY,
    room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sender_user_id   TEXT NOT NULL REFERENCES users(id),
    sender_client_id TEXT NOT NULL,
    epoch            INTEGER NOT NULL,
    seq              INTEGER NOT NULL,
    content_type     TEXT NOT NULL CHECK(content_type IN ('application', 'commit', 'proposal', 'bot')),
    ciphertext       BLOB NOT NULL,
    deleted_at       DATETIME,
    edit_of          TEXT REFERENCES room_messages(id),
    edit_sequence    INTEGER NOT NULL DEFAULT 0,
    edited_at        DATETIME,
    reply_to         TEXT REFERENCES room_messages(id),
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Partial index (line 174):

```sql
CREATE INDEX IF NOT EXISTS idx_room_messages_reply_to ON room_messages(reply_to) WHERE reply_to IS NOT NULL;
```

**Confirmation:** The `reply_to` column definition `reply_to TEXT REFERENCES room_messages(id)` and partial index `idx_room_messages_reply_to` match V3 spec §7.6 exactly.

---

## 2. Current `POST /rooms/:id/messages` Handler

Request shape in `server/src/routes/room_messages.rs` (`SubmitMessageRequest`):

```json
{
  "sender_client_id": "c_...",
  "epoch": 0,
  "content_type": "application",
  "ciphertext": "<base64url>",
  "transcript_hash": "<base64url or null>",
  "reply_to": "m_..." | null
}
```

The handler accepts `reply_to` as an optional string (`Option<String>`). If omitted or `null`, `req.reply_to` is `None`.

Current validation in `server/src/room_messages.rs` (`submit_message`):
- If `reply_to` is `Some(target_id)`, fetches `(room_id, content_type, deleted_at)` for `target_id`.
- If row is missing → returns `RoomMessageError::InvalidReplyTarget { reason: None }` (mapped to HTTP 400 `invalid_reply_target`).
- If `target_room_id != req.room_id` → returns `RoomMessageError::InvalidReplyTarget { reason: Some("not_in_room") }` (mapped to HTTP 400 `invalid_reply_target` with `details.reason = "not_in_room"`).
- If `deleted_at.is_some()` → returns `RoomMessageError::InvalidReplyTarget { reason: Some("deleted") }` (mapped to HTTP 400 `invalid_reply_target` with `details.reason = "deleted"`).
- If `target_content_type != "application"` → returns `RoomMessageError::InvalidReplyTarget { reason: Some("not_application") }` (mapped to HTTP 400 `invalid_reply_target` with `details.reason = "not_application"`).

---

## 3. Current `reply_to` Validation

Currently:
- The handler verifies that `reply_to` refers to a message in the same room.
- On room mismatch: returns `RoomMessageError::InvalidReplyTarget { reason: Some("not_in_room") }`, resulting in HTTP 400 `invalid_reply_target` with `{"details": {"reason": "not_in_room"}}`.
- On non-existent message: returns `RoomMessageError::InvalidReplyTarget { reason: None }`, resulting in HTTP 400 `invalid_reply_target`.

**Alignment needed:**
- Non-existent `reply_to` must return HTTP 400 `reply_to_not_found`.
- Cross-room `reply_to` must return HTTP 400 `reply_to_not_in_room`.

---

## 4. Current Tombstone Interaction

Currently, `submit_message` rejects replies to tombstoned messages (`deleted_at IS NOT NULL`) with HTTP 400 `invalid_reply_target` (`reason = "deleted"`).

**Alignment needed:**
- V3 §7.6 does not restrict replies to active (non-tombstoned) messages. Replying to a tombstoned parent message in the same room must succeed (201 Created).

---

## 5. Current `message.new` Payload

Current event payload published on `private-room-{room_id}` in `server/src/routes/room_messages.rs`:

```json
{
  "id": "m_...",
  "room_id": "r_...",
  "sender_user_id": "u_...",
  "sender_client_id": "c_...",
  "epoch": 0,
  "seq": 1,
  "content_type": "application",
  "reply_to": "m_..." | null,
  "created_at": "..."
}
```

**Comparison with V3 §8.9:**
- V3 §8.9 specifies: `{ id, room_id, sender_type, sender_id, sender_client_id, epoch, seq, content_type, reply_to, bot_key_leaf_index?, created_at }`.
- `reply_to` is present in the current payload and carries string or `null`.
- `sender_type: "user"` and `sender_id: "u_..."` should be included alongside or replacing `sender_user_id` to strictly match V3 §8.9.

---

## 6. Current `GET /rooms/:id/messages` Response

In `server/src/room_messages.rs` (`RoomMessageView`):

`reply_to` is selected from `room_messages` in `list_messages` and included on every row:

```json
{
  "id": "m_...",
  "room_id": "r_...",
  "sender_user_id": "u_...",
  "sender_client_id": "c_...",
  "epoch": 0,
  "seq": 1,
  "content_type": "application",
  "reply_to": "m_..." | null,
  "edit_of": null,
  "edit_sequence": 0,
  "edited_at": null,
  "deleted_at": null,
  "created_at": "...",
  "reactions": []
}
```

**Confirmation:** `reply_to` is present and nullable on every row.

---

## 7. Current `message.edited` Payload

Published on `private-room-{room_id}` in `server/src/routes/room_messages.rs`:

```json
{
  "id": "m_edit_...",
  "edit_of": "m_orig_...",
  "edit_sequence": 1,
  "room_id": "r_...",
  "sender_type": "user",
  "sender_id": "u_...",
  "created_at": "..."
}
```

**Confirmation:** The `message.edited` payload does **not** carry `reply_to`. This matches V3 §8.9.

---

## 8. Current Edit of a Reply

Currently, in `server/src/room_messages.rs` (`edit_message`):
- When an edit row is created (`INSERT INTO room_messages`), `reply_to` is NOT set on the edit row (inserted as `NULL`).
- The returned `RoomMessageView` sets `reply_to: None`.

**Alignment needed:**
- Editing a reply must preserve the original message's `reply_to` on the edit row in `room_messages` (the edit row inherits `reply_to = original.reply_to`).
- `message.edited` event payload continues to omit `reply_to` per §8.9.

---

## 9. Current Cross-Room Reply

Currently, if `reply_to` references a message in room B while posting to room A, `submit_message` detects `target_room_id != req.room_id` and returns `RoomMessageError::InvalidReplyTarget { reason: Some("not_in_room") }` -> HTTP 400 `invalid_reply_target`.

**Alignment needed:**
- Must return HTTP 400 `reply_to_not_in_room`.

---

## 10. Current `reply_to` on Bot Messages

Currently, `SubmitMessageRequest` is used for user messages (`content_type = "application"`, `"commit"`, `"proposal"`). Bot messages (`content_type = "bot"`) are handled via `POST /rooms/:id/bot-messages` in Phase 27. Currently, `submit_message` accepts `reply_to` on application/proposal/commit messages.

---

## 11. Existing Tests

Existing tests touching threading / `reply_to`:
1. `server/tests/message_threading.rs`:
   - `test_capabilities_advertises_threading_enabled`
   - `test_message_send_and_fetch_threading`
   - `test_invalid_reply_targets`
   - `test_non_member_cannot_send_reply`
   - `test_event_payload_and_publish_failure_handling`
   - Batch assignment: `messaging` batch in `server/tests/batch-manifest.toml`.
2. `server/tests/message_edit_write.rs`:
   - Checks `reply_to` is null on edit responses.
   - Batch assignment: `messaging` batch in `server/tests/batch-manifest.toml`.
3. `server/tests/event_publishing.rs`:
   - Checks `message.new` payload shape.
   - Batch assignment: `sockudo` batch in `server/tests/batch-manifest.toml`.

---

## 12. V2 Remnants / Gaps

1. **Error Codes for Invalid `reply_to`:** Currently returns 400 `invalid_reply_target` (with optional `reason` detail) instead of 400 `reply_to_not_found` or 400 `reply_to_not_in_room`.
2. **Replies to Tombstoned Parents:** Currently rejected with 400 `invalid_reply_target` (`reason: "deleted"`). V3 requires accepting replies to tombstoned parent messages.
3. **Replies to Non-Application Messages:** Currently rejected with 400 `invalid_reply_target` (`reason: "not_application"`). V3 §7.6 does not restrict the parent's `content_type`.
4. **Edit Row Inheritance:** Currently, editing a reply inserts `reply_to = NULL` on the edit row instead of setting `reply_to` to the original message's `reply_to`.
5. **`message.new` Payload Fields:** Currently includes `"sender_user_id"` instead of `"sender_type": "user"` and `"sender_id": "u_..."` per §8.9.

---
