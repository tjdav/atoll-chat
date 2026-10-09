# Step 0 Empirical Verification Report: Bot Publisher Key Relay

**Date:** 2026-10-09
**Specification Reference:** Server Specification v3.0.3 §7.4, §8.8.12, §8.8.13, §8.9, §8.10, §12

---

## Empirical Verification Items

### 1. Phase 27 Status
**Status:** Confirmed complete.
The database schema baseline in `server/migrations/0001_v2_schema.sql` contains all five bot account model tables specified in V3 §7.10: `bot_accounts`, `bot_tokens`, `bot_declared_scopes`, `room_bots`, and `room_bot_scopes`. Bot authorization, scope handling, and connection state modules exist under `server/src/bots/`.

### 2. Current `room_publisher_keys` Table
**Status:** Absent.
Searching `server/` confirmed no occurrences of `room_publisher_keys`. The table will be added to `server/migrations/0001_v2_schema.sql` per V3 §7.4:
```sql
CREATE TABLE IF NOT EXISTS room_publisher_keys (
    room_id              TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    epoch                INTEGER NOT NULL,
    publisher_public_key BLOB NOT NULL,
    signer_user_id       TEXT NOT NULL REFERENCES users(id),
    signature            BLOB NOT NULL,
    published_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
Primary key is `room_id`: only the latest published key per room is retained.

### 3. Current `GET /rooms/:id/publisher-key` Handler
**Status:** Absent.
No route or handler exists for fetching publisher keys.

### 4. Current `POST /rooms/:id/publisher-key` Handler
**Status:** Absent.
No route or handler exists for publishing publisher keys.

### 5. Current `room.publisher_key_updated` Publisher
**Status:** Absent.
Searching `server/` confirmed no publishers for `room.publisher_key_updated` or the removed event `room.publisher_key_published`.

### 6. Current Signature Verification Path
**Status:** Absent for publisher keys.
Ed25519 verification primitives (`ed25519_dalek::{VerifyingKey, Signature, Verifier}`) are available in dependencies and used elsewhere (e.g. CLI KT verification). A dedicated helper module `server/src/signing.rs` will be added providing `encode_publisher_key_signing_input` and `verify_publisher_key_signature`.

### 7. Current `identity_pubkey` Lookup for Members
**Status:** Confirmed accessible.
`users.identity_pubkey` is stored in the `users` table as base64url text. Handlers can query `SELECT identity_pubkey FROM users WHERE id = ?` or join `users` with `room_members`.

### 8. Current Bot Channel Registry
**Status:** Confirmed.
Active bot grants in a room are queried via:
```sql
SELECT bot_id FROM room_bots WHERE room_id = ? AND revoked_at IS NULL
```
This is used to fan out `room.publisher_key_updated` events to `private-bot-{bot_id}` channels.

### 9. Current Epoch Source
**Status:** Confirmed.
Room epoch state is stored in `room_epochs` (`room_id`, `epoch`, `sequence`, `confirmed_transcript_hash`). The current epoch is read via `SELECT epoch FROM room_epochs WHERE room_id = ?`.

### 10. Current Epoch Validation Rules
**Status:** Resolved.
V3 §8.8.13 specifies first-publish-wins per epoch without stating an epoch window. Any non-negative integer `epoch` is accepted for publication. If `room_publisher_keys` contains a row for `room_id` with the same `epoch`, publication returns HTTP 409 `epoch_already_published`. A publication for a different epoch replaces the stored row for that room. `GET /rooms/:id/publisher-key` without `?epoch` looks up `room_publisher_keys` where `room_id = ? AND epoch = <current_epoch_from_room_epochs>`.

### 11. Current Auth
**Status:** Resolved.
Endpoints require authentication and active room membership (`room_members`). For `POST /rooms/:id/publisher-key`, bot callers (identified via bot tokens) are rejected with HTTP 403 `forbidden` (only human members may publish).

### 12. Current Event Payloads on Signer's User Channel and Bot Channels
**Status:** Absent.
Will be implemented: `room.publisher_key_updated` published on `private-room-{room_id}` (best-effort), `private-user-{signer_user_id}` (non-durable), and `private-bot-{bot_id}` for each active bot grant in the room (non-durable).

### 13. Current `GET /rooms/:id/publisher-key` Response Shape
**Status:** Absent.
Will match V3 §8.8.12:
```json
{
  "room_id": "r_...",
  "epoch": 42,
  "publisher_public_key": "<base64url>",
  "signer_user_id": "u_...",
  "signature": "<base64url>"
}
```

### 14. Current Base64url Encoding of `publisher_public_key` and `signature`
**Status:** Standard unpadded base64url (`URL_SAFE_NO_PAD`).
`publisher_public_key` decodes to exactly 32 raw bytes. `signature` decodes to exactly 64 raw bytes. Invalid byte lengths return HTTP 400 `invalid_publisher_public_key` or HTTP 400 `invalid_signature`.

### 15. Existing Tests
**Status:** None.
Comprehensive integration tests will be authored in `server/tests/room_publisher_keys.rs` and registered under the `messaging` batch in `server/tests/batch-manifest.toml` and `server/Makefile`.

### 16. V2 Remnants
**Status:** None.
No code path publishes `room.publisher_key_published`, stores publisher keys in memory, or performs server-side verification against MLS state.

---

## Scope Decision

This task delivers the room publisher key relay (`room_publisher_keys` table, `GET` & `POST /rooms/:id/publisher-key`, signing encoding helper, signature verification, first-publish-wins enforcement, and event fanout across room, user, and bot channels). Bot message sending (`POST /rooms/:id/bot-messages`) is not included in this deliverable and remains a separate follow-up task.
