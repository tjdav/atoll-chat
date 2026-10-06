# Empirical Verification Report: Member Pagination and Bot Merge

**Date:** 2026-10-06
**Task:** Phase 11 — Member Pagination and Bot Merge

---

### 1. Current `GET /rooms/:id/members` Handler
- **Path:** `GET /api/v1/rooms/:id/members`
- **Auth:** Required via `AuthUser` (`Authorization: Bearer <token>`).
- **Query Params:** `ListMembersQueryParams { limit: Option<String>, cursor: Option<String> }`.
- **Rate Limit:** Rate limit checked via `RateLimitKey::MemberList`.
- **Current Response Shape:**
  ```json
  {
    "members": [
      {
        "user_id": "...",
        "username_token": "...",
        "encrypted_display": "...",
        "role": "...",
        "joined_at": "..."
      }
    ],
    "next_cursor": "..." | null,
    "has_more": bool
  }
  ```
- **Comparison to V3 §8.4:**
  - V3 §8.4 requires merged entries with explicit `type`: `"user"` or `"bot"`.
  - User entries in §8.4 carry: `type`, `user_id`, `role`, `joined_at`.
  - Bot entries in §8.4 carry: `type`, `bot_id`, `mode`, `display_name`, `avatar_file_id`, `joined_at`.
  - Top level in §8.4 carries: `members` and `next_cursor`. The `username_token`, `encrypted_display`, and `has_more` fields in the current implementation are V2 remnants that must be aligned to §8.4.

---

### 2. Current Cursor Format
- **Format:** Unpadded base64url JSON: `{"room_id": "...", "last_user_id": "..."}`.
- **Validation & Errors:**
  - If `cursor.room_id != id` (room mismatch): Returns HTTP 400 `invalid_cursor`.
  - If base64 decoding or JSON parsing fails: Returns HTTP 400 `invalid_cursor`.

---

### 3. Current Ordering
- **Order:** `user_id ASC`.
- **Stability:** Ordering is stable across page boundaries using `rm.user_id > cursor.last_user_id`.

---

### 4. Current Bot Tables
- **Schema File:** `server/migrations/0001_v2_schema.sql`.
- **Check:** Neither `bot_accounts` nor `room_bots` currently exist in `0001_v2_schema.sql`.
- **Action:** Minimal schema (`bot_accounts` and `room_bots`) will be added to `server/migrations/0001_v2_schema.sql` per Deliverable 1.

---

### 5. Current `room_members` Role Semantics
- **Roles:** `owner`, `moderator`, `member` enforced by SQLite `CHECK(role IN ('owner', 'moderator', 'member'))`.
- **Resolution:** Fetched directly from `room_members.role`.

---

### 6. Current `room.member_added` / `room.member_removed` Events
- **Channel:** `private-room-{room_id}`.
- **Payloads:**
  - `room.member_added`: `{ "room_id": "...", "user_id": "...", "role": "...", "joined_at": "..." }`.
  - `room.member_removed`: `{ "room_id": "...", "user_id": "..." }`.
- **Alignment:** Both match V3 §8.9 exactly.

---

### 7. Current Bot Merge
- **Status:** No bot merge exists. The query currently selects exclusively from `room_members JOIN users`.

---

### 8. Current Response Shape
- **Current JSON:** Top-level `{ "members": [...], "next_cursor": ..., "has_more": ... }`.
- **Item JSON:** User entries lack `type: "user"` and contain extra fields (`username_token`, `encrypted_display`).
- **Comparison to §8.4:** `type: "user"` must be added. `username_token` and `encrypted_display` must be removed from user entries. `has_more` must be omitted from top level. Bot entries must carry `type: "bot"`, `bot_id`, `mode`, `display_name`, `avatar_file_id`, `joined_at`.

---

### 9. Current Pagination Cap
- **Default Limit:** 50.
- **Max Limit:** 200 (clamped via `.min(200)`).
- **Validation:** Limit <= 0 or invalid integer returns HTTP 400 `invalid_limit`.

---

### 10. Existing Tests
- **Test File:** `server/tests/room_members_pagination.rs`
- **Test Cases:**
  1. `test_member_list_pagination_first_page_default_limit`
  2. `test_member_list_pagination_custom_limit_and_pages`
  3. `test_member_list_pagination_limit_clamping_and_validation`
  4. `test_member_list_pagination_cursor_validation`
  5. `test_member_list_pagination_auth_and_concurrency`
- **Batch Assignment:** `messaging` batch in `server/tests/batch-manifest.toml`.

---

### 11. V2 Remnants
- User member items return `username_token` and `encrypted_display`.
- User member items lack `type: "user"`.
- Top-level response includes `has_more`.
- Query only inspects `room_members` table and ignores bot entries.
