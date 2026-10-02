# Verification V-F — `users.profile` Semantics and Avatar Storage Reconciliation

**Date:** 2026-10-02
**Status:** Complete (Canonical)
**Spec References:**
- Server Specification v2.0: §2.4, §7.1, §7.2, §8.2.1, §8.2.2, §8.2.3, §8.2.4, §8.8, §14.3, §16 (Amendments), §17 (V1 Log)
- Client Specification v1.0: §7.1, §8.4, §13.5, §13.6, §13.7, §17.1, §24

---

## Executive Summary

This verification closes the gap between Verification V-E (Avatar Storage and Visibility Model) and the server's `users.profile` / `users.profile_version` database columns prior to implementing Task 32 (Avatar Upload).

**Key Findings:**
1. **Self-Only Storage:** `users.profile` and `users.profile_version` are strictly self-only. `GET /users/me` returns `profile` and `profile_version`, and `PATCH /users/me` updates them. No endpoint (`POST /users/lookup`, `GET /rooms/:id/members`, etc.) ever exposes `profile` or `profile_version` to other users.
2. **Avatar Location (Option A Confirmed):** The user's profile avatar attachment ID lives inside the client's opaque, end-to-end encrypted profile blob stored in `users.profile`.
3. **Terminology Reconciliation:** `ui-profile` in Client Spec v1.0 §7.1 is the client-side Web Component tag used for visually rendering profile avatars. `users.profile` in Server Spec v2.0 §7.1 is the server database column storing the client's opaque encrypted profile payload.
4. **Task 32 Gating:** **Task 32 is unblocked with Interpretation A (V-E).** No server database schema changes are required.

---

## 1. Specification Citations

### Server Specification v2.0 Citations

- **§2.4 (Breaking Changes from V1):** Does not list `users.profile` as a breaking change. Replaced legacy plaintext `users.display_name` with `users.encrypted_display`.
- **§7.1 (`users` table):**
  ```sql
  CREATE TABLE users (
      id                  TEXT PRIMARY KEY,
      username_token      TEXT NOT NULL UNIQUE,
      encrypted_display   TEXT,
      opaque_registration BLOB NOT NULL,
      identity_pubkey     TEXT NOT NULL,
      profile             TEXT,
      profile_version     INTEGER NOT NULL DEFAULT 1,
      max_file_size_bytes INTEGER,
      created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      disabled_at         DATETIME,
      deleted_at          DATETIME
  );
  ```
- **§7.2 (User-Scoped Sync Tables):** Defines `user_seq`, `read_state`, `user_preferences`, `device_names`, `starred_items`, and `sync_events`. `users.profile` is **not** a user-scoped sync table; it is a column directly on the `users` table.
- **§8.2.1 (`GET /users/me`):** Returns the authenticated user's own profile:
  ```json
  {
    "id": "<user_id>",
    "username_token": "<base64>",
    "encrypted_display": "<base64>",
    "identity_pubkey": "<base64>",
    "profile": "<base64>",
    "profile_version": 1,
    "created_at": "<ISO 8601>"
  }
  ```
- **§8.2.2 (`PATCH /users/me`):** Accepts profile update from the authenticated user:
  ```json
  {
    "encrypted_display": "<base64>",
    "profile": "<base64>"
  }
  ```
- **§8.2.3 (`POST /users/lookup`):** Returns lookup result for another user:
  ```json
  {
    "user_id": "<user_id>",
    "encrypted_display": "<base64url or null>"
  }
  ```
  *Note:* `profile` and `profile_version` are omitted.
- **§8.2.4 (`GET /users/me/sync`):** Returns user-scoped sequence state (`read_state`, `user_preferences`, `device_state`, `starred_items`). `profile` is not returned in sync responses.
- **§8.8 (Sockudo Event Catalog):** `user.updated` event payload carries `{ user_id, profile_version, user_seq }`.
- **§14.3 (Data Export):** `GET /users/me/export` exports user profile metadata in `profile.json` (including `username_token`, `encrypted_display`, `profile`, and `profile_version`).
- **§16.x (Amendments):** No amendment in §16 touches `users.profile`.
- **§17 (V1 Amendment Log):** No V1 amendment log entry references `profile`.

### Client Specification v1.0 Citations

- **§7.1 (Primitives):** Defines `ui-profile` as the component tag for user/group profile avatars:
  `ui-profile | User/group profile | size, shape, src, state, fallback`
- **§8.4 (C2SP Attachment Encryption):** Explicitly defines C2SP purpose string `"user-avatar"` for user profile images alongside `"room-avatar"`, `"message"`, `"session-icon"`, and `"sticker"`.
- **§13.5 (Room Settings - Profile Block):** References the "Profile block" in room settings (room avatar, room name, E2EE badge).
- **§13.6 (Room Metadata JSON):** Room avatar is stored in room encrypted metadata JSON via `avatar_file_id`.
- **§13.7 (Room Avatar Upload):** Room owner uploads room avatar attachment and updates room metadata JSON.
- **§17.1 (Account Settings - Profile):**
  `Profile | Navigate → display name, profile image, username (read-only)`
- **§24 (Design Decisions Log):** Decision 1 (OPRF lookup, encrypted display names), Decision 33 (GDPR account deletion sets `encrypted_display = NULL` and `profile = NULL`).

---

## 2. Repository Inspection

Grep commands executed in `server/`:

```bash
grep -rn "profile" src/ migrations/ tests/ | grep -vi "profile_version\|profiling"
grep -rn "profile_version" src/ migrations/ tests/
```

### Findings

1. **Database Migrations:**
   - `migrations/0001_initial.sql`: Originally created `profile_blob TEXT` and `profile_version INTEGER NOT NULL DEFAULT 1` on `users`.
   - `migrations/0020_users_oprf_identity.sql`: Recreated `users` table with `profile TEXT` and `profile_version INTEGER NOT NULL DEFAULT 1`.

2. **Server Handlers (`server/src/routes/users.rs`):**
   - `get_me` (`GET /api/v1/users/me`): Queries `SELECT username_token, encrypted_display, profile, profile_version, identity_pubkey, max_file_size_bytes, created_at FROM users WHERE id = ?` and returns `UserView`.
   - `update_me` (`PATCH /api/v1/users/me`): Rejects deprecated field `profile_blob` with HTTP 400 `field_renamed` (`details: { old: "profile_blob", new: "profile" }`). Validates base64url payload length, increments `profile_version` when `profile` is modified, and executes `UPDATE users SET encrypted_display = ?, profile = ?, profile_version = ? WHERE id = ?`.

3. **User Registration (`server/src/routes/register.rs`):**
   - `register_finish`: Inserts user row with `profile = NULL` and `profile_version = 1`.

4. **GDPR Account Deletion & Export (`server/src/gdpr.rs`):**
   - `anonymise_user`: Sets `profile = NULL` upon account deletion.
   - `build_export`: Reads `profile` and `profile_version` and includes them in `profile.json` in the user's export archive.

5. **DTO Structs:**
   - `UserView` in `server/src/routes/users.rs`:
     ```rust
     pub profile: Option<String>,
     pub profile_version: i64,
     ```

6. **Integration Tests (`server/tests/`):**
   - `server/tests/profile_oprf.rs` (`test_profile_update_and_renamed_fields`): Tests updating `profile` via `PATCH /users/me`, verifying `profile_version` increments from 1 to 2, and verifying rejection of deprecated `profile_blob`.
   - `server/tests/gdpr_identity.rs`: Verifies `profile.json` export contains `profile` and `profile_version`.
   - `server/tests/auth.rs` & `server/tests/backup_restore.rs`: Exercise profile fields.

---

## 3. Profile Visibility Model

1. **Is `users.profile` exposed to other users?**
   **No.** `POST /users/lookup` (§8.2.3) returns only `{ user_id, encrypted_display }`. `GET /rooms/:id/members` (§8.4 / Task 30) returns member user IDs, roles, and join timestamps. No server endpoint exposes another user's `profile` or `profile_version`.

2. **Is that a deliberate privacy choice or a spec gap?**
   It is a **deliberate zero-knowledge privacy choice** in Server Spec v2.0. The server operates as an untrusted metadata-minimised relay.

3. **Does the client spec expect the profile to be cross-user visible?**
   No. Client Spec v1.0 §17.1 defines "Profile" as an Account Settings screen for the current user's own display name, profile image, and username.

4. **How does avatar visibility work across users?**
   - **Room Avatars:** Shared among room members via room encrypted metadata JSON (`avatar_file_id` in §13.6).
   - **User Avatars:** The user's profile avatar attachment reference is stored inside the client's encrypted `profile` payload on `users.profile` (or synced across the user's own devices via `user_preferences`). Cross-user profile avatar broadcasting is not part of Server Spec v2.0.

---

## 4. Location of the Avatar Attachment ID

**Confirmed: Option A — inside `users.profile`.**

- The client uploads its user avatar attachment using C2SP purpose `"user-avatar"` (§8.4).
- The client inserts the resulting attachment ID into its client-side encrypted profile JSON object.
- The client base64url-encodes the encrypted profile payload and sends it to the server via `PATCH /users/me { "profile": "<base64url>" }`.
- The server stores the opaque string in `users.profile` and increments `profile_version`.
- On new device setup or sync, `GET /users/me` returns `profile` and `profile_version`, allowing the user's devices to decrypt the profile and obtain the avatar attachment ID.

---

## 5. Terminology Reconciliation

- **`ui-profile` (Client Spec v1.0 §7.1):** The client-side UI Web Component / template tag used to render user and room group avatar circles (`<ui-profile>`).
- **`users.profile` (Server Spec v2.0 §7.1):** The server database column on the `users` table that stores the client's end-to-end encrypted user profile payload.

These concepts are directly related across the architecture: `ui-profile` is the client UI renderer, while `users.profile` is the server-side storage column for the client-encrypted profile payload containing the avatar reference rendered by `ui-profile`.

---

## 6. Decision

**Confirmation of V-E under Option A.**

V-E's conclusion stands. `users.profile` is the server-side home for the client's opaque encrypted profile payload, which contains the user's avatar attachment ID. The profile is strictly self-only. Cross-user user avatar visibility is out of scope for Server Spec v2.0.

---

## 7. Task 32 Gating

**Task 32 is unblocked with Interpretation A (V-E).**

- `POST /users/me/avatar` (or attachment upload) processes the image upload through the attachment pipeline with C2SP purpose `"user-avatar"` and returns the attachment record DTO.
- No database schema changes or spec amendments are required.
- The client stores the resulting attachment ID in its encrypted profile payload and updates `users.profile` via `PATCH /users/me`.
