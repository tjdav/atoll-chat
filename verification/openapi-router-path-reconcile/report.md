# Empirical Verification Report — OpenAPI-Router Path Reconciliation

**Date:** 2026-10-16
**Scope:** OpenAPI and Router Path Alignment
**Working Specifications:** Server Specification v3.0.4 (§8.1, §8.1.1, §8.1.6, §8.3)

---

## Executive Summary

This empirical report establishes the baseline state for the 4 path discrepancies identified between `docs/openapi.json` and Axum router registrations in `server/src/lib.rs`.

The reconciliation resolves:
1. **Health and Ready:** Router registers `/health` and `/ready` at root. OpenAPI previously annotated `/api/v1/health` and `/api/v1/ready`. OpenAPI annotations in `routes/health.rs` and `routes/ready.rs` will be changed to `/health` and `/ready`.
2. **OPRF Blind:** Router registered both `/oprf/blind` (root alias) and `/api/v1/oprf/blind`. OpenAPI annotates `/api/v1/oprf/blind`. All integration tests call `/api/v1/oprf/blind`. The root alias `/oprf/blind` in `server/src/lib.rs` will be removed so only `/api/v1/oprf/blind` remains, matching OpenAPI and test conventions.
3. **Sockudo Auth:** Spec §8.1.6 mandates mounting at reverse-proxy root `/sockudo/auth`, not under `/api/v1/`. Router previously registered `/sockudo/auth` inside `api_routes`, producing `/api/v1/sockudo/auth`. Router registration in `lib.rs` will be moved from `api_routes` to root `app` at `/sockudo/auth`. Integration tests calling `/api/v1/sockudo/auth` will be updated to call `/sockudo/auth`.
4. **Admin Sessions:** Spec §8.3 mandates `GET /admin/rooms/:id/sessions` ("Read-only session list"). Handler `list_admin` exists in `routes/room_sessions.rs` with OpenAPI annotation `GET /api/v1/admin/rooms/{id}/sessions`, but was omitted from router registrations in `lib.rs`. The route `/admin/rooms/{id}/sessions` will be registered under `api_routes` in `lib.rs` pointing to `list_admin` with an admin role authorization check.

---

## 1. Current Router Registrations

Inspection of `server/src/lib.rs` shows:

- **`/health`**: Registered at root (Line 635): `.route("/health", get(routes::health::handler))`. Not in `api_routes`.
- **`/ready`**: Registered at root (Line 636): `.route("/ready", get(routes::ready::handler))`. Not in `api_routes`.
- **`/oprf/blind`**: Registered twice:
  - In `api_routes` (Line 337): `.route("/oprf/blind", post(routes::oprf::blind))` (resolves to `/api/v1/oprf/blind`).
  - At root `app` (Line 637): `.route("/oprf/blind", post(routes::oprf::blind))` (resolves to `/oprf/blind`).
- **`/sockudo/auth`**: Registered once in `api_routes` (Line 542): `.route("/sockudo/auth", post(routes::sockudo::auth_handler))` (resolves to `/api/v1/sockudo/auth`). NOT registered at root.
- **Admin sessions**: Not registered anywhere in `server/src/lib.rs`.

---

## 2. Current OpenAPI Entries

Inspection of `docs/openapi.json` shows:

- **`/health`**: Absent. Contains `/api/v1/health`.
- **`/ready`**: Absent. Contains `/api/v1/ready`.
- **`/oprf/blind`**: Absent at root. Contains `/api/v1/oprf/blind`.
- **`/sockudo/auth`**: Present as `/sockudo/auth`. Absent as `/api/v1/sockudo/auth`.
- **`/api/v1/admin/rooms/{id}/sessions`**: Present in `docs/openapi.json`.

---

## 3. Client-Facing Convention in Tests

Search across `server/tests/` reveals:

- **Health (`GET`)**:
  - `server/tests/static.rs` calls `GET /health`.
  - `server/tests/transport.rs` calls `GET /health`.
  - Zero tests call `GET /api/v1/health`.
  - **Verdict:** Operational convention is root `GET /health`.
- **Ready (`GET`)**:
  - `server/tests/ready.rs` calls `GET /ready`.
  - `server/tests/transport.rs` calls `GET /ready`.
  - Zero tests call `GET /api/v1/ready`.
  - **Verdict:** Operational convention is root `GET /ready`.
- **OPRF Blind (`POST`)**:
  - `server/tests/oprf_blind.rs` calls `POST /api/v1/oprf/blind` across all test cases.
  - `server/tests/invites.rs`, `server/tests/devices.rs`, `server/tests/key_packages.rs`, `server/tests/common/mod.rs` call `POST /api/v1/oprf/blind`.
  - Zero tests call root `POST /oprf/blind`.
  - **Verdict:** Operational convention is `POST /api/v1/oprf/blind`.
- **Sockudo Auth (`POST`)**:
  - `server/tests/sockudo.rs` calls `POST /api/v1/sockudo/auth`.
  - `server/tests/sync_channel_auth.rs` calls `POST /api/v1/sockudo/auth`.
  - Zero tests call root `POST /sockudo/auth`.
  - **Verdict:** Tests currently use `/api/v1/sockudo/auth`, which violates spec §8.1.6. Tests must be updated to call `/sockudo/auth`.

---

## 4. Admin Sessions Route Status

- **Function Name**: `list_admin` in `server/src/routes/room_sessions.rs`.
- **Router Registration**: Omitted from `server/src/lib.rs`.
- **Implementation**: Delegates to `list_room_sessions`. Currently lacks an admin role check.
- **OpenAPI Annotation**: Annotated on `list_admin` in `server/src/routes/room_sessions.rs` as `GET /api/v1/admin/rooms/{id}/sessions`.
- **Spec Mandate**: Server Spec v3.0.4 §8.3 table explicitly lists `GET /admin/rooms/:id/sessions` ("Read-only session list").
- **Verdict**: Register `GET /admin/rooms/{id}/sessions` in `api_routes` in `server/src/lib.rs` pointing to `list_admin`, and enforce admin authorization in `list_admin`.

---

## 5. Specification Mandates

Quoting Server Spec v3.0.4:

- **§8.1 Public Table**:
  - `GET /health` — Liveness
  - `GET /ready` — Readiness
  - `POST /oprf/blind` — OPRF evaluation
- **§8.1.6 Sockudo Auth**:
  - "Mounted at the reverse-proxy root, not under /api/v1/. Path configurable via SOCKUDO_AUTH_PATH; default /sockudo/auth."
- **§8.3 Admin Table**:
  - `GET /admin/rooms/:id/sessions` — Read-only session list

---

## 6. Current OpenAPI Path Count

- Total path items in `docs/openapi.json`: **68** (covering 68 unique OpenAPI path strings across 83 method-path pairs).

---

## 7. Current Test Assertions

`server/tests/openapi_generation.rs` asserts:
- `expected_paths` includes `"/api/v1/health"`, `"/api/v1/ready"`, `"/api/v1/admin/rooms/{id}/sessions"`, `"/sockudo/auth"`, `"/api/v1/oprf/blind"`.
- `unauthenticated_paths` asserts `("/api/v1/health", "get")` and `("/api/v1/ready", "get")`.
- `authenticated_paths` asserts `("/api/v1/admin/rooms/{id}/sessions", "get")` and `("/sockudo/auth", "post")`.

Updates required in `openapi_generation.rs`:
- Replace `"/api/v1/health"` with `"/health"`.
- Replace `"/api/v1/ready"` with `"/ready"`.
- Verify router vs OpenAPI 1:1 match assertion.

---

## 8. Discrepancy Reconciliation Summary

| Path | Current Router | Current OpenAPI | Action Taken | Final Router Path | Final OpenAPI Path |
|---|---|---|---|---|---|
| Health | `/health` | `/api/v1/health` | Update OpenAPI annotation to `/health` | `/health` | `/health` |
| Ready | `/ready` | `/api/v1/ready` | Update OpenAPI annotation to `/ready` | `/ready` | `/ready` |
| OPRF Blind | `/oprf/blind` & `/api/v1/oprf/blind` | `/api/v1/oprf/blind` | Remove root router alias; keep `/api/v1/oprf/blind` | `/api/v1/oprf/blind` | `/api/v1/oprf/blind` |
| Sockudo Auth | `/api/v1/sockudo/auth` | `/sockudo/auth` | Move router registration to root `/sockudo/auth`; update test calls | `/sockudo/auth` | `/sockudo/auth` |
| Admin Sessions | Missing | `/api/v1/admin/rooms/{id}/sessions` | Register route in `lib.rs` with admin auth check | `/api/v1/admin/rooms/{id}/sessions` | `/api/v1/admin/rooms/{id}/sessions` |

After these changes, every router route will map 1:1 to an OpenAPI path item and match spec mount points.
