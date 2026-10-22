# Empirical Verification Report — P2P Signaling Endpoint

**Date:** 2026-10-24
**Author:** Server Engineering Team
**Subject:** Step 0 Baseline Verification & Specifications Reference for P2P File Transfer Signaling Relay

---

## 1. Call Signal Handler Reference Implementation

- **Handler Location:** `server/src/routes/calls.rs::signal_handler` and `server/src/calls/signal.rs::send_signal`.
- **Request Struct (`SignalRequest`):**
  ```rust
  pub struct SignalRequest {
      pub sender_client_id: String,
      pub target_user_id: String,
      pub target_client_id: String,
      pub envelope: String,
  }
  ```
- **Auth Model:** `AuthUser` extractor enforcing valid bearer session token.
- **Target Validation:** Checks `call_occupancy.find_user_for_client(call_id, &req.target_client_id)` and asserts `target_user == req.target_user_id`.
- **Publish Path:** `publisher.publish(&format!("private-user-{}", req.target_user_id), "call.signal", event_payload)`.
- **Response Shape:** `SignalResponse { delivered_to: 1 }` (HTTP 200 OK).
- **Error Codes:**
  - `501 calling_disabled`
  - `404 room_not_found`
  - `403 not_a_participant`
  - `403 sender_client_not_owned`
  - `404 target_not_found`
  - `400 target_user_mismatch`
  - `400 invalid_envelope`
  - `429 rate_limited`

---

## 2. Call Signal Rate Limit

- **Key Format:** `call_signal:{user_id}:{call_id}:min:{boundary}`
- **Window:** `Window::Minute`
- **Config Entry:** `rate_call_signal_per_min: u32` (default `120`, env `RATE_CALL_SIGNAL_PER_MIN`).

---

## 3. Call Signal Event Payload

- **Published Channel:** `private-user-{target_user_id}`
- **Event Name:** `call.signal`
- **Payload Shape:**
  ```json
  {
    "call_id": "c_...",
    "sender_user_id": "u_...",
    "sender_client_id": "c_...",
    "target_client_id": "c_...",
    "envelope": "<base64url>"
  }
  ```
- **Durability:** Non-durable. Direct publish to Sockudo; not written to `user_event_log` or `bot_event_log`.

---

## 4. User Channel Non-Durable Publish Pattern

`call.signal` and `session.signal` publish directly to Sockudo publisher over `private-user-{target_user_id}`. No `allocate_user_seq` or `user_seq` increment occurs, and `next_seq` on `user_seq` table remains untouched.

---

## 5. Device Ownership Check

The endpoint checks `devices::find_by_client_id(pool, caller_id, &sender_client_id)` (or occupancy client ownership check). Query returns `Option<DeviceRow>`. If `None`, returns `400 invalid_sender_client_id` (or `400 sender_client_not_owned`). P2P will use `devices::find_by_client_id(pool, caller_id, sender_client_id)`.

---

## 6. Room Membership Check

From `rooms::get_room_for_user(pool, room_id, caller_id)`:
```rust
sqlx::query_as(
    "SELECT r.*, rm.role as current_user_role, ... FROM rooms r JOIN room_members rm ON r.id = rm.room_id WHERE r.id = ? AND rm.user_id = ?"
)
```
If returning `None`, caller is not in the room (`403 not_a_member`).

---

## 7. Target User Membership

To check if `target_user_id` is a member of `room_id`:
```rust
let is_target_member: bool = sqlx::query_scalar(
    "SELECT EXISTS(SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?)"
)
.bind(room_id)
.bind(target_user_id)
.fetch_one(pool)
.await?;
```
If `false`, returns `404 target_not_in_room`.

---

## 8. Config Pattern for Rate Limits

- Config Field: `rate_p2p_signal_per_min: u32`
- Structs: `RateLimitConfig` and `Config` in `server/src/config.rs`.
- Env Var Name: `RATE_P2P_SIGNAL_PER_MIN`
- Default: `120`

---

## 9. RateLimitKey Enum Pattern

- Variant: `RateLimitKey::P2pSignal { user_id: String, room_id: String }`
- Location: `server/src/rate_limit.rs`.
- Key Format: `p2p_signal:{user_id}:{room_id}:min:{boundary}` where `boundary` is `start.format("%Y-%m-%d-%H-%M")`.
- Window: `Window::Minute`
- Limit Source: `config.rate_p2p_signal_per_min`

---

## 10. Handler Test Harness

Existing tests in `server/tests/call_signaling.rs` use `setup_test_app`, `create_test_user`, `create_room`, `add_member`, send HTTP requests using `app.oneshot(req)`, capture WireMock received requests from `mock_server.received_requests()`, and assert status codes (`StatusCode::OK`, `StatusCode::FORBIDDEN`, `StatusCode::TOO_MANY_REQUESTS`, etc.).

---

## 11. Router Registration Pattern

In `server/src/lib.rs`, room-family routes under `api_routes` are nested:
```rust
.route("/rooms/:id/p2p/signal", post(routes::p2p::signal_handler))
```

---

## 12. Existing Tests That May Collide

Searched `server/tests/` for `p2p`, `P2P`, `p2p.signal`. Result: zero occurrences. No collisions.

---

## 13. Batch Assignment

The new integration test file `server/tests/p2p_signal.rs` joins the `messaging` batch in `server/tests/batch-manifest.toml`.

---

## Specification Amendment — P2P Signaling Endpoint (for Specification Team publication)

**Title:** Amendment §2026-10-24 — P2P File Transfer Signaling Relay

1. **§5.6 Rate Limits:**
   - Add configuration key `RATE_P2P_SIGNAL_PER_MIN=120`.
   - Add rate limit key format `p2p_signal:{user_id}:{room_id}:min:{boundary}`.

2. **§8.5 Room Endpoints:**
   - Add §8.5.2 `POST /api/v1/rooms/:id/p2p/signal`:
     - **Auth:** Bearer session token.
     - **Request Body:** `{ sender_client_id, target_user_id, target_client_id, envelope }`.
     - **Checks:** Caller room membership (403 `not_a_member`), Target room membership (404 `target_not_in_room`), Caller device ownership of `sender_client_id` (400 `invalid_sender_client_id`), Envelope valid base64url <= 64 KiB (400 `invalid_envelope`). Rate limit 120/min per (user, room) (429 `rate_limited`).
     - **Behavior:** Relays envelope to `private-user-{target_user_id}` as `p2p.signal`. Returns `{ "delivered_to": 1 }`.
     - **Durability:** Non-durable. Not persisted. Not logged.

3. **§8.9 User Channel Events:**
   - Add event row:
     - **Event:** `p2p.signal`
     - **Payload:** `{ room_id, sender_user_id, sender_client_id, target_client_id, envelope }`
     - **Durable:** No

4. **§14.6 Metadata Minimization:**
   - Add: "P2P signaling metadata is transient, not persisted, not logged. The envelope is opaque to the server."
