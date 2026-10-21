# Verification Report: Client Events Configuration and Capability Exposure

**Date:** 2026-10-21
**Target Spec:** Server Spec v3.0.4 (§5.19, §8.1)
**Deliverable:** `verification/verify-client-events-config/report.md`

---

## Executive Summary

The client team expressed concern that typing indicators depend on Sockudo client events (`client-typing.start`, `client-typing.stop`), and if `enableClientMessages` (or `enable_client_events`) is disabled on Sockudo, typing events are rejected and typing indicators silently fail without visibility to the client.

This verification audited the server configuration, propagation paths, Sockudo container management, app creation flows, capabilities advertisement, event whitelisting, rate limits, and failure modes across `server/src/`.

### Key Findings

1. **Unused Server Environment Variable:** `SOCKUDO_ENABLE_CLIENT_EVENTS` is read in `server/src/config.rs` (defaulting to `true`) and mapped to `Config.sockudo_enable_client_events` and `Publisher.config.enable_client_events`. **However, this boolean is never passed to Sockudo, never used to configure Sockudo via HTTP, and never exposed in `GET /capabilities`.**
2. **Sockudo Container Configuration Ownership:** Sockudo is run as an independent container (or process) using Sockudo's native configuration (e.g. `config.json` or Sockudo CLI flags). The Axum server **does not create or configure the Sockudo app on startup** over HTTP.
3. **Capabilities Exposure Gap:** `GET /capabilities` advertises `websocket_url` (or `sockudo_url`), `sockudo_app_key`, and `sockudo_auth_endpoint`, but **does NOT expose `client_events_enabled`** (or `sockudo_client_events`). The client currently has no way to inspect whether client events are enabled without attempting to publish one.
4. **Client-Direct WebSocket Delivery:** Client events (`client-typing.start` / `client-typing.stop`) are published directly from the client to Sockudo over the WebSocket connection (`private-room-{room_id}`). They do **NOT** pass through the Axum server HTTP API. The server only handles channel subscription authorization via `POST /sockudo/auth`.
5. **Client Concern Validity:** The client's concern is **VALID**. If Sockudo is deployed with `enableClientMessages: false` (or if `SOCKUDO_ENABLE_CLIENT_EVENTS` was intended to control Sockudo), typing events sent by clients over WebSockets are rejected by Sockudo with a Pusher error payload or dropped, and the server receives zero indication.

---

## 1. Environment Variable Read

- **File & Line:** `server/src/config.rs:1088-1090`
- **Variable Name:** `SOCKUDO_ENABLE_CLIENT_EVENTS`
- **Field Name in `Config`:** `pub sockudo_enable_client_events: bool` (`server/src/config.rs:160`)
- **Type:** `bool`
- **Default Value:** `true` (when `SOCKUDO_ENABLE_CLIENT_EVENTS` is unset or empty)
- **Parsing Rule:**
  ```rust
  let sockudo_enable_client_events = env::var("SOCKUDO_ENABLE_CLIENT_EVENTS")
      .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
      .unwrap_or(true);
  ```

*Note on Rename Task 1:* `SOCKUDO_ENABLE_CLIENT_EVENTS` has not yet been renamed to `WEBSOCKET_ENABLE_CLIENT_EVENTS` in `server/src/config.rs`.

---

## 2. Propagation Path & Consumers

The configuration value propagates through the server state as follows:

1. **Config Struct:** `Config.sockudo_enable_client_events` (`server/src/config.rs:160`, `1438`, `1612`).
2. **Sockudo Config:** Transferred to `SockudoConfig.enable_client_events` in `SockudoConfig::load_or_initialize` (`server/src/sockudo/mod.rs:131`).
3. **Publisher Struct:** Stored on `Publisher.config.enable_client_events` (`server/src/sockudo/publisher.rs:19`, `61`).
4. **Getter Method:** Accessible via `Publisher::enable_client_events(&self) -> bool` (`server/src/sockudo/publisher.rs:60-62`).

### Consumers Analysis
A comprehensive search across `server/src/` for uses of `enable_client_events()` or `sockudo_enable_client_events` yields **zero operational consumers**:
- It is **not** passed to any Sockudo app creation or management API (no app creation REST API exists or is called).
- It is **not** returned in `GET /capabilities` (`server/src/routes/capabilities.rs`).
- It is **not** checked in `POST /sockudo/auth` or any subscription handler.
- It does **not** affect any server-side HTTP or event publishing logic.

**Conclusion:** The environment variable is read into memory on startup but is currently completely decorative / dead configuration within the Axum server process.

---

## 3. Sockudo Container Configuration

- **Repository Files:** `docker-compose.yml` does not exist in this repository.
- **Sockudo App Setup:** In the v3.0 architecture (Server Spec v3.0.4 §1.5, §5.19), Sockudo runs in its own Docker container alongside the Axum server.
- **Configuration Mechanism:** Sockudo is configured independently via its own environment variables or configuration file (`config.json`), where `enableClientMessages` (or `clientEvents`) is a container-level setting.
- **Sourcing:** The setting in the Sockudo container is **independent** of the Axum server's `SOCKUDO_ENABLE_CLIENT_EVENTS` environment variable unless both containers share environment definitions in a deployment harness (e.g. Docker Compose or Helm chart).

---

## 4. App Creation Flow

- **Server-Initiated App Creation:** **Does NOT exist.** In v3.0.4, the Axum server does not call an HTTP endpoint on startup to create or configure the Sockudo application.
- **Startup Connection Check:** During `SockudoConfig::load_or_initialize` (`server/src/sockudo/mod.rs:113-125`), the Axum server sends an HTTP `GET` reachability request to `{http_base}/up/{app_id}` to verify Sockudo is reachable. No configuration parameters are sent in this probe.
- **App Credentials:** `sockudo_app_key` and `sockudo_app_secret` are auto-generated on first boot and persisted in the `server_config` database table (if set to `"auto"`), or read from environment variables.

---

## 5. Capabilities State

Currently, `docs/openapi.json` and `server/src/routes/capabilities.rs` declare the following `CapabilitiesResponse` fields related to real-time transport:

- `websocket_url` (or `sockudo_url` per v3.0.5 realignment)
- `sockudo_app_key`
- `sockudo_auth_endpoint`
- `sockudo_channel_prefix`

### OpenAPI Schema Assessment (`docs/openapi.json`)
Inspecting `CapabilitiesResponse` in `docs/openapi.json`:
```json
"sockudo_app_key": { "type": "string" },
"sockudo_channel_prefix": { "type": "string" },
"websocket_url": { "type": "string" }
```
`client_events_enabled` (or `sockudo_client_events`) is **NOT** present in `docs/openapi.json` or `CapabilitiesResponse`.

---

## 6. Client Event Type Whitelist

Per Server Spec v3.0.4 §5.19, the allowable client events are strictly limited:
- `client-typing.start` (on `private-room-{room_id}`)
- `client-typing.stop` (on `private-room-{room_id}`)

### Server vs. Sockudo Whitelisting
- **Server Enforcement:** Because client events travel directly from client WebSocket connections to Sockudo, the Axum server never receives or inspects client event packets.
- **Sockudo Enforcement:** Sockudo handles client event routing. In Sockudo / Pusher protocol, client events must be prefixed with `client-`. Whitelisting of specific client event names (`client-typing.start` vs arbitrary `client-*`) is enforced by Sockudo container configuration or client convention.

---

## 7. Rate Limits & Per-Event Restrictions

- **Server Rate Limits:** The Axum server enforces rate limits on server-initiated HTTP actions (e.g., `RATE_SOCKUDO_AUTH_PER_MIN = 300` on `POST /sockudo/auth`).
- **Client Event Rate Limits:** Client events (`client-typing.*`) do not pass through Axum HTTP endpoints. Therefore, rate limiting and payload validation for client events are enforced by Sockudo's native client event throttling rules, not by Axum.

---

## 8. Failure Mode Analysis

If `enableClientMessages` is disabled (`false`) on the Sockudo container:

1. **Client Event Rejection:** When a client sends a Pusher client event (e.g. `client-typing.start`) over the WebSocket connection, Sockudo rejects the message.
2. **WebSocket Error Message:** Sockudo returns a Pusher error event over the WebSocket (e.g., error code 4301 or `Client events are disabled`).
3. **Server Visibility:** The Axum server receives **no logs, no errors, and no events**. The failure is completely invisible to the server.
4. **Client Experience:** If the client application does not listen for Pusher WebSocket error events, typing events silently fail and typing indicators never appear for other room members.

---

## 9. Root Cause Question

> **Question:** Is the client's concern about client events being silently off valid? Or is there some other path (e.g. the server relays typing via HTTP) that the client may have missed?

**Direct Answer:**
**The client's concern IS VALID.**
Typing indicators in Atoll rely exclusively on Sockudo client events (`client-typing.start` and `client-typing.stop`) sent directly over WebSockets on `private-room-{room_id}` channels (§5.19). There is no alternative HTTP relay path for typing events on the server. If client events are disabled on Sockudo or if the client assumes they are enabled when they are not, typing indicators silently fail. Furthermore, the server currently reads `SOCKUDO_ENABLE_CLIENT_EVENTS` but fails to advertise it in `GET /capabilities`.

---

## 10. Recommendations

1. **Expose `client_events_enabled` in Capabilities (v3.0.5 Patch Candidate):**
   Update `CapabilitiesResponse` in `server/src/routes/capabilities.rs` and `docs/openapi.json` to expose a boolean field:
   ```json
   "client_events_enabled": true
   ```
   (populated from `state.publisher.enable_client_events()`). This allows client applications to check feature availability at runtime before attempting typing events.

2. **Code Alignment for `SOCKUDO_ENABLE_CLIENT_EVENTS`:**
   Document in deployment guides that `SOCKUDO_ENABLE_CLIENT_EVENTS` configures the server's capabilities advertisement flag, which should match the Sockudo container's `enableClientMessages` deployment setting.

3. **Pending Task Entries:**
   Add a pending task entry in `task-ledger.md` for adding `client_events_enabled` to `CapabilitiesResponse` and regenerating `docs/openapi.json` in a follow-up patch.
