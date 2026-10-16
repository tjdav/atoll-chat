# Non-Spec Route Register

**Date:** 2026-10-16
**Scope:** Inventory and Recommendation Register for Non-Spec Server Routes
**Baseline Document:** `verification/endpoint-inventory-reconciliation/report.md`

---

## Executive Summary

During the endpoint inventory reconciliation task, 52 unique HTTP paths (comprising 71 `(Method, Path)` pairs) registered in `server/src/lib.rs` were identified as lacking explicit §8 counterparts in Server Specification v3.0.4.

Per the task constraints, **no routes have been removed**. All 52 non-spec routes remain active, registered in the router, and covered by automated tests. This document serves as the authoritative register and provides recommendations for each route for a future specification update or decision.

---

## Non-Spec Route Inventory & Recommendations

| # | Method(s) | Full Path | Registration Site (`server/src/lib.rs`) | Test Files (`server/tests/`) | Repository Code References | Closest Spec Section | Recommendation |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/v1/admin/altcha/rotate` | Line 293 | `admin_routes.rs` | `routes/admin.rs` | §8.3, §5.11 | Keep as internal route; exclude from OpenAPI until spec section added. |
| 2 | GET | `/api/v1/admin/audit` | Line 260 | `admin_routes.rs` | `routes/admin.rs` | §8.3, §5.17, §14.8 | Keep as internal admin tool; add §8.3 section or exclude from OpenAPI. |
| 3 | GET, POST | `/api/v1/admin/backups` | Line 285 | 59 test files | `routes/admin_backups.rs` | §8.3, §5.9, §13 | Keep as internal admin tool; add §8.3 section or exclude from OpenAPI. |
| 4 | GET, PATCH | `/api/v1/admin/config` | Line 252 | `admin_routes.rs` | `routes/admin.rs` | §8.3, §7.12 | Keep as internal admin tool; add §8.3 section or exclude from OpenAPI. |
| 5 | GET, POST | `/api/v1/admin/invites` | Line 394 | 7 test files | `routes/invites.rs` | §8.3, §7.3 | Keep as internal admin tool; add §8.3 section or exclude from OpenAPI. |
| 6 | DELETE | `/api/v1/admin/invites/{id}` | Line 398 | `admin_routes.rs` | `routes/invites.rs` | §8.3, §7.3 | Keep as internal admin tool; add §8.3 section or exclude from OpenAPI. |
| 7 | GET, PATCH | `/api/v1/admin/limits` | Line 256 | `admin_routes.rs` | `routes/admin.rs` | §8.3, §4 | Keep as internal admin tool; add §8.3 section or exclude from OpenAPI. |
| 8 | POST | `/api/v1/admin/vapid/rotate` | Line 289 | `admin_routes.rs` | `routes/admin.rs` | §8.3, §7.8 | Keep as internal admin tool; add §8.3 section or exclude from OpenAPI. |
| 9 | GET, DELETE | `/api/v1/attachments/{id}` | Line 608 | 7 test files | `routes/attachments.rs` | §8.6 | Keep & add §8.6 spec section for attachment download & delete. |
| 10 | POST | `/api/v1/attachments/{id}/presign` | Line 612 | 5 test files | `routes/attachments.rs` | §8.6 | Keep & add §8.6 spec section for S3 URL presigning. |
| 11 | POST | `/api/v1/calls/turn-credentials` | Line 559 | `turn_credentials.rs` | `routes/calls.rs` | §8.7, §8.7.3, §5.24 | Keep & add §8.7.3 spec section for TURN credential fetch. |
| 12 | POST | `/api/v1/keypackages` | Line 450 | 16 test files | `routes/key_packages.rs` | §8.5, §7.5 | Keep & add §8.5 spec section for MLS keypackages upload. |
| 13 | POST | `/api/v1/keypackages/claim` | Line 452 | 3 test files | `routes/key_packages.rs` | §8.5, §7.5 | Keep & add §8.5 spec section for MLS keypackage claim. |
| 14 | GET | `/api/v1/keypackages/count` | Line 451 | 72 test files | `routes/key_packages.rs` | §8.5, §7.5 | Keep & add §8.5 spec section for MLS keypackage count. |
| 15 | GET | `/api/v1/roles` | Line 319 | `roles_permissions.rs` | `routes/roles.rs` | §3.1 | Keep & add §8.2 section for roles listing. |
| 16 | GET, POST | `/api/v1/rooms` | Line 406 | 99 test files | `routes/rooms.rs` | §8.4 | Keep & add §8.4 spec section for room creation & listing. |
| 17 | POST | `/api/v1/rooms/join` | Line 410 | 34 test files | `routes/room_invites.rs` | §8.4, §7.3 | Keep & add §8.4 spec section for joining room via invite code. |
| 18 | GET, PATCH, DELETE | `/api/v1/rooms/{id}` | Line 411 | 102 test files | `routes/rooms.rs` | §8.4 | Keep & add §8.4 spec section for room details, metadata edit, delete. |
| 19 | POST | `/api/v1/rooms/{id}/attachments` | Line 607 | 61 test files | `routes/attachments.rs` | §8.6 | Keep & add §8.6 spec section for room attachment upload. |
| 20 | POST | `/api/v1/rooms/{id}/calls/{call_id}/end` | Line 575 | 53 test files | `routes/calls.rs` | §8.7, §5.24 | Keep & add §8.7 spec section for ending call. |
| 21 | POST | `/api/v1/rooms/{id}/calls/{call_id}/join` | Line 563 | 53 test files | `routes/calls.rs` | §8.7, §8.7.5 | Keep & add §8.7.5 spec section for joining call. |
| 22 | POST | `/api/v1/rooms/{id}/calls/{call_id}/leave` | Line 567 | 53 test files | `routes/calls.rs` | §8.7, §8.7.6 | Keep & add §8.7.6 spec section for leaving call. |
| 23 | POST | `/api/v1/rooms/{id}/calls/{call_id}/signal` | Line 571 | 53 test files | `routes/calls.rs` | §8.7, §8.7.7 | Keep & add §8.7.7 spec section for WebRTC signaling. |
| 24 | GET | `/api/v1/rooms/{id}/epoch` | Line 538 | 53 test files | `routes/room_messages.rs` | §8.5, §7.4 | Keep & add §8.5 spec section for room epoch fetch. |
| 25 | GET, POST | `/api/v1/rooms/{id}/invites` | Line 417 | 98 test files | `routes/room_invites.rs` | §8.4, §7.3 | Keep & add §8.4 spec section for room invites CRUD. |
| 26 | DELETE | `/api/v1/rooms/{id}/invites/{invite_id}` | Line 421 | 67 test files | `routes/room_invites.rs` | §8.4, §7.3 | Keep & add §8.4 spec section for room invite revocation. |
| 27 | POST | `/api/v1/rooms/{id}/leave` | Line 425 | 56 test files | `routes/rooms.rs` | §8.4 | Keep & add §8.4 spec section for leaving room. |
| 28 | GET, POST | `/api/v1/rooms/{id}/members` | Line 426 | 55 test files | `routes/rooms.rs` | §8.4 | Keep & add §8.4 spec section for member listing & add. |
| 29 | DELETE | `/api/v1/rooms/{id}/members/{uid}` | Line 430 | 53 test files | `routes/rooms.rs` | §8.4 | Keep & add §8.4 spec section for kicking room member. |
| 30 | POST | `/api/v1/rooms/{id}/members/{uid}/demote` | Line 438 | 53 test files | `routes/rooms.rs` | §8.4, §3.2 | Keep & add §8.4 spec section for demoting room member. |
| 31 | POST | `/api/v1/rooms/{id}/members/{uid}/promote` | Line 434 | 53 test files | `routes/rooms.rs` | §8.4, §3.2 | Keep & add §8.4 spec section for promoting room member. |
| 32 | GET, POST | `/api/v1/rooms/{id}/messages` | Line 453 | 74 test files | `routes/room_messages.rs` | §8.5, §8.5.1 | Keep & add §8.5.1 spec section for message fetch & post. |
| 33 | PATCH, DELETE | `/api/v1/rooms/{id}/messages/{message_id}` | Line 457 | 69 test files | `routes/room_messages.rs` | §8.5 | Keep & add §8.5 spec section for message edit & delete. |
| 34 | GET | `/api/v1/rooms/{id}/messages/{message_id}/ciphertext` | Line 534 | 53 test files | `routes/room_messages.rs` | §8.5 | Keep & add §8.5 spec section for message raw ciphertext fetch. |
| 35 | GET, POST | `/api/v1/rooms/{id}/messages/{message_id}/reactions` | Line 526 | 83 test files | `routes/reactions.rs` | §8.5 | Keep & add §8.5 spec section for reaction list & add. |
| 36 | DELETE | `/api/v1/rooms/{id}/messages/{message_id}/reactions/{reaction_id}` | Line 530 | 64 test files | `routes/reactions.rs` | §8.5 | Keep & add §8.5 spec section for reaction removal. |
| 37 | GET | `/api/v1/rooms/{id}/pending-adds` | Line 551 | 53 test files | `routes/rooms.rs` | §8.5, §7.5 | Keep & add §8.5 spec section for pending MLS adds. |
| 38 | POST | `/api/v1/rooms/{id}/pending-adds/{add_id}/consume` | Line 555 | 53 test files | `routes/rooms.rs` | §8.5, §7.5 | Keep & add §8.5 spec section for consuming pending MLS add. |
| 39 | GET | `/api/v1/rooms/{id}/pending-removes` | Line 543 | 74 test files | `routes/pending_removes.rs` | §8.5, §7.5 | Keep & add §8.5 spec section for pending MLS removes. |
| 40 | POST | `/api/v1/rooms/{id}/pending-removes/{remove_id}/consume` | Line 547 | 60 test files | `routes/pending_removes.rs` | §8.5, §7.5 | Keep & add §8.5 spec section for consuming pending MLS remove. |
| 41 | POST | `/api/v1/rooms/{id}/retention/preview` | Line 442 | 53 test files | `routes/rooms.rs` | §8.4, §4.5 | Keep & add §8.4 spec section for retention preview. |
| 42 | GET, POST | `/api/v1/rooms/{id}/sessions` | Line 579 | 98 test files | `routes/room_sessions.rs` | §8.7, §8.7.8 | Keep & add §8.7.8 spec section for room session list & create. |
| 43 | PATCH, DELETE | `/api/v1/rooms/{id}/sessions/{session_id}` | Line 583 | 82 test files | `routes/room_sessions.rs` | §8.7 | Keep & add §8.7 spec section for room session patch & delete. |
| 44 | POST | `/api/v1/rooms/{id}/sessions/{session_id}/heartbeat` | Line 595 | 53 test files | `routes/room_sessions.rs` | §8.7 | Keep & add §8.7 spec section for room session heartbeat. |
| 45 | POST | `/api/v1/rooms/{id}/sessions/{session_id}/join` | Line 587 | 74 test files | `routes/room_sessions.rs` | §8.7 | Keep & add §8.7 spec section for joining room session. |
| 46 | POST | `/api/v1/rooms/{id}/sessions/{session_id}/leave` | Line 591 | 56 test files | `routes/room_sessions.rs` | §8.7 | Keep & add §8.7 spec section for leaving room session. |
| 47 | GET | `/api/v1/rooms/{id}/sessions/{session_id}/roster` | Line 599 | 53 test files | `routes/room_sessions.rs` | §8.7 | Keep & add §8.7 spec section for room session roster. |
| 48 | POST | `/api/v1/rooms/{id}/sessions/{session_id}/signal` | Line 603 | 54 test files | `routes/room_sessions.rs` | §8.7 | Keep & add §8.7 spec section for room session signaling. |
| 49 | POST | `/api/v1/rooms/{id}/transfer` | Line 446 | 53 test files | `routes/rooms.rs` | §8.4, §3.5 | Keep & add §8.4 spec section for room ownership transfer (alias for transfer-ownership). |
| 50 | GET | `/api/v1/welcomes` | Line 539 | 56 test files | `routes/welcomes.rs` | §8.7, §8.7.1 | Keep & add §8.7.1 spec section for pending MLS welcomes fetch. |
| 51 | GET | `/api/v1/welcomes/{id}` | Line 540 | 82 test files | `routes/welcomes.rs` | §8.7, §8.7.2 | Keep & add §8.7.2 spec section for MLS welcome bytes fetch. |
| 52 | POST | `/api/v1/welcomes/{id}/consume` | Line 541 | 12 test files | `routes/welcomes.rs` | §8.7 | Keep & add §8.7 spec section for consuming MLS welcome. |
