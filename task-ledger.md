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

## Summary
- **Total Tasks Tracked:** 13
- **Done:** 13
- **Pending:** 0
- **Mismatches:** 0
