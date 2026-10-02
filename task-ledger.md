# Task Ledger

## Completed Verifications

- **V-B — Key Transparency Scale Verification**: done
  - **Delivered:** `verification/key-transparency-scale/report.md`
  - **Recommendation:** Interpretation B (RFC 6962-lite)
- **V-D — Repository State Verification**: done
  - **Delivered:** `verification/repo-state/report.md`
  - **Recommendation:** Reconciled ground truth across migrations, test files, schema, routes, CLI, env vars, rate limits, capabilities, events, task ledger, and verification log.
- **V-F — `users.profile` Semantics and Avatar Storage Reconciliation**: done
  - **Delivered:** `verification/users-profile/report.md`
  - **Outcome:** Reconciled `users.profile` and `users.profile_version` as self-only client-encrypted profile payload home (Option A / Interpretation A). Task 32 (Avatar Upload) is unblocked with no server schema changes required.

## Completed Tasks

- **Task 21a — OPRF Blind Endpoint**: done
  - **Verified:** `server/src/oprf/`, `POST /api/v1/oprf/blind`
- **Task 21b — OPRF Identity Schema & Protocol**: done
  - **Verified:** `0020_users_oprf_identity.sql`, `server/src/identity/`
- **Task 21c — OPRF Key Rotation & Flag**: done
  - **Verified:** `0025_requires_reregistration.sql`, `server/src/oprf/rotation.rs`, `POST /api/v1/admin/oprf/rotate`, `server rotate-oprf`
- **Task 23 — User-Scoped Sync Foundation**: done
  - **Verified:** `0021_user_seq.sql`, `server/src/sync/`, `GET /api/v1/users/me/sync`
- **Task 24a — Read State Write & Sync**: done
  - **Verified:** `0022_read_state.sql`, `POST /api/v1/users/me/read-state`
- **Task 24b — Room Order Preference**: done
  - **Verified:** `0023_user_preferences.sql`, `PATCH /api/v1/users/me/room-order` (via preferences)
- **Task 24c — Generic Preferences**: done
  - **Verified:** `0023_user_preferences.sql`, `server/src/sync/preferences.rs`, `/api/v1/users/me/preferences/{key}`
- **Task 25 — Device Name Encryption & Sync**: done
  - **Verified:** `0024_device_names.sql`, `server/src/identity/device_name.rs`, `PATCH /api/v1/users/me/devices/{id}`
- **Phase 15a/15b/16 — Push Notification Delivery**: done
  - **Verified:** `server/src/push/`, WebPush, APNs, FCM senders, capabilities integration
- **Phase 17 — Automated Backups & Restore CLI**: done
  - **Verified:** `server/src/backup/`, `GET/POST /api/v1/admin/backups`, `server restore`
- **MIG-FIX — Remove Redundant requires_reregistration Migration**: done
  - **Verified:** Removed redundant migration `0025_requires_reregistration.sql`. All 24 migrations run successfully on clean database.
- **Task 26 — Room Metadata with Encrypted Payload**: done
  - **Migration:** `0026_rooms_metadata.sql` (Case A: dropped `name_encrypted`, added `metadata` and `metadata_version`).
  - **Delivered:** `0026_rooms_metadata.sql`, `server/src/rooms.rs`, `server/src/routes/rooms.rs`, `server/src/rate_limit.rs`, `server/src/config.rs`, `server/src/error.rs`, `server/README.md`, `room_metadata_write.rs`, `room_metadata_validation.rs`, `room_metadata_events.rs`.
  - **Batch:** `messaging`
- **Task 27 — Message Editing**: done
  - **Migration:** `0027_message_edit_columns.sql` (Case A: added `edit_of`, `edit_sequence`, `edited_at` columns and `idx_room_messages_edit_of` partial index).
  - **Delivered:** `0027_message_edit_columns.sql`, `server/src/room_messages.rs`, `server/src/routes/room_messages.rs`, `server/src/rate_limit.rs`, `server/src/config.rs`, `server/src/audit.rs`, `server/src/error.rs`, `server/src/lib.rs`, `server/README.md`, `message_edit_write.rs`, `message_edit_validation.rs`, `message_edit_events.rs`.
  - **Batch:** `messaging`
- **Task 28 — Message Reactions**: done
  - **Migration:** `0028_reactions.sql` (Case A: created `reactions` table with unique constraint `(message_id, sender_user_id, sender_client_id, reaction)` and partial/indexing strategy).
  - **Delivered:** `0028_reactions.sql`, `server/src/reactions/mod.rs`, `server/src/reactions/write.rs`, `server/src/reactions/list.rs`, `server/src/routes/reactions.rs`, `server/src/room_messages.rs`, `server/src/routes/room_messages.rs`, `server/src/limits.rs`, `server/src/rate_limit.rs`, `server/src/config.rs`, `server/.env.example`, `server/src/audit.rs`, `server/src/error.rs`, `server/src/lib.rs`, `server/src/main.rs`, `server/README.md`, `reaction_write.rs`, `reaction_validation.rs`, `reaction_list.rs`, `reaction_events.rs`.
  - **Batch:** `messaging`
- **Task 29 — Message Threading (`reply_to`)**: done
  - **Migration:** `0029_message_reply_to.sql` (Case A: added `reply_to TEXT REFERENCES room_messages(id)` column and `idx_room_messages_reply_to` partial index).
  - **Delivered:** `0029_message_reply_to.sql`, `server/src/room_messages.rs`, `server/src/routes/room_messages.rs`, `server/src/routes/capabilities.rs`, `server/src/error.rs`, `message_threading.rs`.
  - **Batch:** `messaging`
- **Task 15b-R — Push Payload `sender_ref` Retrofit**: done
  - **Delivered:** `server/src/identity/token.rs`, `server/src/push/payload.rs`, `server/src/push/delivery.rs`, `server/src/push/apns.rs`, `server/src/push/fcm.rs`, `server/tests/push_payload.rs`, `server/tests/push_delivery.rs`, `server/tests/push_delivery_native.rs`, `server/tests/push_subscriptions.rs`, `server/tests/push_suppression.rs`.
  - **Batch:** `push`
- **Task 30 — Room Member Pagination**: done
  - **Migration:** None (Case A: `room_members` composite primary key `(room_id, user_id)` efficiently supports `user_id > ?` cursor pagination).
  - **Delivered:** `server/src/rooms.rs`, `server/src/routes/rooms.rs`, `server/src/rate_limit.rs`, `server/src/config.rs`, `server/tests/attachments_presign.rs`, `server/tests/rooms.rs`, `server/tests/room_members_pagination.rs`, `server/tests/batch-manifest.toml`, `server/Makefile`.
  - **Batch:** `messaging`
- **Task 22a — Recovery Code Generation**: done
  - **Migration:** `0030_recovery_codes.sql` (Case B: created `recovery_codes` table with `id`, `user_id`, `code_hash`, `code_salt`, `consumed_at`, `created_at` and index `idx_recovery_codes_user`).
  - **Delivered:** `0030_recovery_codes.sql`, `server/src/recovery_code.rs`, `server/src/lib.rs`, `server/Cargo.toml`, `server/tests/recovery_code.rs`, `server/tests/batch-manifest.toml`, `server/Makefile`.
  - **Batch:** `identity`
- **Task 22b — Recovery Endpoints and OPAQUE Re-registration**: done
  - **Migration:** None (Case A: in-memory `RecoveryStore` option chosen).
  - **Delivered:** `server/src/recovery.rs`, `server/src/routes/recover.rs`, `server/src/rate_limit.rs`, `server/src/config.rs`, `server/src/audit.rs`, `server/src/lib.rs`, `server/src/main.rs`, `server/src/cleanup/memory.rs`, `server/src/cleanup/mod.rs`, `server/tests/recovery_endpoints.rs`, `server/tests/batch-manifest.toml`, `server/Makefile`.
  - **Batch:** `identity`
- **Task 31 — Retention Change Preview**: done
  - **Migration:** None (Case A: pure read-only preview using existing tables).
  - **Delivered:** `server/src/rooms.rs`, `server/src/routes/rooms.rs`, `server/src/lib.rs`, `server/tests/retention_preview.rs`, `server/tests/batch-manifest.toml`, `server/Makefile`.
  - **Batch:** `messaging`

## Annotations for Future Tasks

- **Task 32 — Avatar Upload (`POST /users/me/avatar`)**: Unblocked per Verification V-F (and V-E). Image asset is processed via the attachment pipeline with C2SP purpose `"user-avatar"` and returns the attachment record DTO. Client stores resulting attachment ID inside its client-encrypted profile payload and updates `users.profile` via `PATCH /users/me`. No server database schema change required.

## Summary
- **Total Verifications/Tasks Tracked:** 24
- **Done:** 24
- **Pending:** 0
- **Mismatches:** 0
