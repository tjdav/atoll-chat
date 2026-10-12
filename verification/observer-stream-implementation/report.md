# Step 0 — Empirical Verification Report: Observer Stream Implementation

**Date:** 2026-10-12
**Scope:** Phase 31 of V3 Spec §11 (Room Event Broadcast and Bot Observer Stream)

---

### 1. Current SSE Infrastructure
- **Search results:** `axum::response::sse`, `text/event-stream`, `Sse<` were searched in `server/src/`. Zero matches found. No SSE endpoint currently exists in the codebase.
- **Axum version:** `server/Cargo.toml` uses `axum = "0.8"`. In Axum 0.8, `axum::response::sse::{Event, KeepAlive, Sse}` is available in the core crate without extra feature flags.

### 2. Current Room-Channel Publish Helper
- **Function:** `Publisher::publish(&self, channel: &str, event: &str, data: serde_json::Value)` in `server/src/sockudo/publisher.rs`.
- **Call sites:** Invoked across `server/src/routes/room_messages.rs`, `server/src/routes/rooms.rs`, `server/src/routes/room_bots.rs`, `server/src/routes/reactions.rs`, `server/src/rooms.rs`, `server/src/calls/lifecycle.rs`, etc., for channels starting with `private-room-`.
- **Broadcast integration point:** `Publisher::publish` checks `if let Some(room_id) = channel.strip_prefix("private-room-")` and invokes `self.room_events.publish(RoomEventEnvelope { room_id, event, data })` **before** the Sockudo HTTP call.

### 3. Current Publisher Implementation
- **Signature:** `pub async fn publish(&self, channel: &str, event: &str, data: serde_json::Value) -> Result<(), SockudoError>`
- **Side effects:** Currently, the only side effect is an HTTP POST to Sockudo. Adding the in-process `room_events` broadcast is best-effort, non-blocking, and precedes the Sockudo call.

### 4. Current `AppState` Definition
- **Location:** `server/src/lib.rs`.
- **Sharing pattern:** `AppState` is wrapped in `Arc<AppState>` at the application root in `main.rs` and Axum router state.
- **New field:** `pub room_events: RoomEventBroadcast` (value type, no `Arc` wrapper around `RoomEventBroadcast`, as `RoomEventBroadcast` internally holds `tokio::sync::broadcast::Sender` which is cheap to clone). `AppState` also stores `pub observer_cursors: ObserverCursorStore`.

### 5. Current Bot Token Auth
- **Function:** `crate::routes::bots::resolve_caller(&state.pool, &headers, &state).await`
- **Behavior:** Returns `CallerIdentity::Bot(BotContext)` if a valid Bearer bot token is supplied, or `CallerIdentity::User(AuthUser)` for user session tokens.
- **Observer stream enforcement:** If `caller` is `CallerIdentity::User`, the observer stream handler immediately returns `401 Unauthorized`.

### 6. Current `read_metadata` Scope Check
- **Grant & scope query pattern:**
  ```sql
  SELECT EXISTS(
      SELECT 1 FROM room_bots rb
      JOIN room_bot_scopes rbs ON rbs.room_id = rb.room_id AND rbs.bot_id = rb.bot_id
      WHERE rb.room_id = ? AND rb.bot_id = ? AND rb.revoked_at IS NULL AND rbs.scope = 'read_metadata'
  )
  ```
- If false, the endpoint returns `403 Forbidden` (`forbidden`).

### 7. Current `RATE_BOT_OBSERVER_STREAM_PER_MIN` Config
- **Status:** Absent in `server/src/config.rs`.
- **Action:** Added `rate_bot_observer_stream_per_min: u32` to `RateLimitConfig` defaulting to 10 (overridable via `RATE_BOT_OBSERVER_STREAM_PER_MIN`).

### 8. Current `RateLimitKey::BotObserverStream` Variant
- **Status:** Absent in `server/src/rate_limit.rs`.
- **Action:** Added `RateLimitKey::BotObserverStream { bot_id: String }` mapping to key string `bot_observer_stream:{bot_id}:min:{boundary}` with `Window::Minute`.

### 9. Current `message.new` Payload Shape
- **Room channel payload:** Emitted with `{ id, room_id, sender_type, sender_id, sender_client_id, epoch, seq, content_type, reply_to, created_at, ... }`. Does not carry `size_bytes`.
- **`size_bytes` source:** Computed by querying `SELECT LENGTH(ciphertext) FROM room_messages WHERE id = ?` in the projection filter (returning raw ciphertext byte count).

### 10. Current `message.edited` Payload Shape
- **Room channel payload:** Emitted with `{ id, edit_of, edit_sequence, room_id, sender_type, sender_id, created_at }`.
- **Derivation:** `id` = edit message ID; `edit_of` = original message ID; `editor_user_id` = `sender_id`; `edited_at` = `created_at`.

### 11. Current `message.deleted` Payload Shape
- **Room channel payload:** Emitted with `{ id, room_id }`. Projected as `{ id }`.

### 12. Current `room.member_added` / `room.member_removed` Payloads
- **Room channel payload:** Carries member metadata. Forwarded unmodified in the observer stream allowlist filter.

### 13. Current `room.updated` Payload Shape
- **Room channel payload:** Emitted with `{ room_id, metadata }`.
- **Observer projection:** Projects `{ room_id, retention_days, max_file_size_bytes, metadata_version }` (omitting null/absent fields and strictly excluding `metadata`).

### 14. Current Axum Version and Feature Flags
- **Version:** Axum 0.8 in `server/Cargo.toml`. `axum::response::sse` is available without extra feature gates.

### 15. Current Graceful Shutdown Behavior
- Long-lived SSE connections hold `broadcast::Receiver` instances and terminate naturally when the connection drops or the server process terminates.

### 16. Existing Tests and Batch Assignment
- **Related tests:** `event_publishing.rs`, `bots.rs`, `room_bots.rs`.
- **New test file:** `server/tests/observer_stream.rs`.
- **Batch assignment:** `bots` batch in `server/tests/batch-manifest.toml` and `server/Makefile`.

### 17. V2 Remnants
- No prior observer stream endpoints or cursor persistence existed.
