# Empirical Verification Report: Whisper Messages

## 1. Current `room_messages.target_user_ids` Column
- **Presence & Status:** The `target_user_ids` column is currently **missing** from the `room_messages` table in `server/migrations/0001_v2_schema.sql`.
- **Requirement:** As specified in V3 §7.6, `target_user_ids TEXT` (nullable) must be added to `room_messages`.
  - NULL denotes a public message.
  - Non-null string stores a JSON array of user IDs (e.g. `["u_recipient1", "u_recipient2"]`).

## 2. Current `POST /rooms/:id/messages` Handler
- **Request Shape:** `SubmitMessageRequest` in `server/src/routes/room_messages.rs` currently accepts:
  `{ "sender_client_id": "...", "epoch": 0, "content_type": "...", "ciphertext": "...", "transcript_hash": null, "reply_to": null }`.
- **Target User IDs:** Currently omitted from `SubmitMessageRequest` and unhandled.
- **Validation:** No validation currently exists. Per specification, `target_user_ids` must be validated for:
  - Non-empty array (empty array `[]` returns HTTP 400 `invalid_target_user_ids`).
  - Cap limit against effective room size (`rooms.room_size` / instance limit / server hard max; exceeding returns HTTP 400 `target_user_ids_too_large`).
  - Membership check for all target user IDs in `room_members` (non-member targets return HTTP 400 `target_not_in_room`).

## 3. Current `message.new` Publish Site
- **Code Path:** `submit` in `server/src/routes/room_messages.rs` (lines 142–170).
- **Channel Target:** Publishes `message.new` strictly on `private-room-{room_id}` via `state.publisher.publish(&channel, "message.new", msg_payload)`.
- **Defensive Strip:** Does not currently check or strip `target_user_ids`.

## 4. Current `message.edited` Publish Site
- **Phase 7 Stub:** Present in `edit` in `server/src/routes/room_messages.rs` (lines 437–440):
  `// Phase 10: Whisper edits (target_user_ids non-null on the original) must be routed to each recipient's private-user-{user_id} channel and to the sender's own channel. The room channel must receive nothing for a whisper, including edits. See §8.9 notes.`
- **Current Payload:** `{ "id": "...", "edit_of": "...", "edit_sequence": 1, "room_id": "...", "sender_type": "user", "sender_id": "...", "created_at": "..." }`.
- **Response Body:** Includes `"target_user_ids": serde_json::Value::Null`.

## 5. Current `message.deleted` Publish Site
- **Code Path:** `delete_message` in `server/src/routes/room_messages.rs` (lines 351–362).
- **Current Payload:** `{ "id": message_id, "room_id": id }`.
- **Target User IDs:** Currently omitted and not checked.

## 6. Current `reaction.added` and `reaction.removed` Publish Sites
- **Phase 8 Stubs:** Present in `add` and `remove` in `server/src/routes/reactions.rs` (lines 146–149 & 249–252):
  `// Phase 10: For whisper messages (target_user_ids non-null on the parent message), reaction events must route to each recipient's private-user-{user_id} channel and to the sender's own channel. The room channel must receive nothing for a whisper. See §8.9 notes.`
- **Current Payloads:**
  - `reaction.added`: `{ "id": "...", "room_id": "...", "message_id": "...", "sender_user_id": "...", "reaction": "...", "created_at": "..." }` on `private-room-{room_id}`.
  - `reaction.removed`: `{ "id": "...", "room_id": "...", "message_id": "..." }` on `private-room-{room_id}`.

## 7. Current `GET /rooms/:id/messages` Handler
- **Code Path:** `list_messages` in `server/src/room_messages.rs` and `list` in `server/src/routes/room_messages.rs`.
- **Filtering:** Currently verifies room membership for the requester and returns all messages in the room.
- **Whisper Visibility:** Non-recipients would currently see whisper rows if any existed. Filtering logic must be added so rows with non-null `target_user_ids` are returned ONLY if the requester's `user_id` matches `sender_user_id` or is contained within `target_user_ids`.

## 8. Current `room_messages` Indexes
- **Existing Indexes:** `idx_room_messages_room_epoch_seq`, `idx_room_messages_room_created`, `idx_room_messages_sender`, `idx_room_messages_room_deleted`, `idx_room_messages_edit_of`, `idx_room_messages_reply_to`.
- **Index on `target_user_ids`:** Absent in `0001_v2_schema.sql` and §7.6.
- **Justification for No Index:** Queries on `room_messages` are always bounded by `room_id` and paginated by `(epoch, seq)` or `created_at`. Scanning rows within a room page to apply whisper filtering in memory / SQL is lightweight. An index on a JSON string column would incur write overhead without query performance gains.

## 9. Current Recipient Validation
- **Current State:** Unimplemented.
- **Proposed Rule:** When `target_user_ids` is present and non-empty in `SubmitMessageRequest`, query `room_members` for the room. Verify that every user ID in `target_user_ids` is present in `room_members`. If any target user ID is not a member of the room, reject the request with HTTP 400 `target_not_in_room`.

## 10. Current Delivery Helper & Durability
- **Current State:** `publish_user_event` in `server/src/sync/envelope.rs` requires a `user_seq` and publishes durable state rows for sync.
- **Non-durable Events:** Whisper events delivered on `private-user-{user_id}` are non-durable live events per §8.9 notes (they do not allocate a `user_seq` and do not participate in `GET /users/me/sync`). They publish directly using `state.publisher.publish(&format!("private-user-{}", user_id), event_name, payload)`.

## 11. Current Sender's Own Device Filtering
- **Current State:** For whisper delivery, the recipient set is constructed as `target_user_ids ∪ {sender_user_id}`. The event is delivered to all devices subscribed to `private-user-{sender_user_id}`.
- **Filtering Mechanism:** The event payload includes `sender_client_id`. The client-side runtime filters out its own events on the sending device by comparing `sender_client_id` against its own `client_id`, while other devices of the sender apply the event for read-state consistency per §8.9 notes.

## 12. Existing Tests
- **Existing References:** `server/tests/message_edit_write.rs` line 204 asserts `edit1_body["target_user_ids"].is_null()`. `server/tests/moderation.rs` has a local function parameter named `target_user_ids`.
- **Batch Assignment:** `message_edit_write.rs` is assigned to the `messaging` batch in `server/tests/batch-manifest.toml`.

## 13. V2 Remnants
- No whisper handling code currently exists in `submit`, `edit`, `delete_message`, or reaction routes.
- All events currently publish directly to `private-room-{room_id}` without checking or stripping `target_user_ids`.
