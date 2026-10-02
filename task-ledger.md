# Task Ledger

## Completed Verifications

- **V-B — Key Transparency Scale Verification**: done
  - **Delivered:** `verification/key-transparency-scale/report.md`
  - **Recommendation:** Interpretation B (RFC 6962-lite)
- **V-D — Repository State Verification**: done
  - **Delivered:** `verification/repo-state/report.md`
  - **Recommendation:** Reconciled ground truth across migrations, test files, schema, routes, CLI, env vars, rate limits, capabilities, events, task ledger, and verification log.

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

## Summary
- **Total Tasks Tracked:** 15
- **Done:** 15
- **Pending:** 0
- **Mismatches:** 0
