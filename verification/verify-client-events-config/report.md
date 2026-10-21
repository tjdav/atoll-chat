# Verification Report: Sockudo Client Events Configuration and Capability Exposure

## Executive Summary

An investigation of the server configuration, Sockudo publisher module, repository deployment artifacts, capabilities handler, and OpenAPI specification was conducted to verify the configuration, propagation, container setup, and capabilities exposure for Sockudo client events (`enableClientMessages`).

The audit confirms that `SOCKUDO_ENABLE_CLIENT_EVENTS` (and its rename alias `WEBSOCKET_ENABLE_CLIENT_EVENTS`) is properly parsed in `server/src/config.rs` (defaulting to `true`) and passed to `sockudo::Publisher`. However, the server does not manage or provision the external Sockudo WebSocket server application; Sockudo reads its own configuration file or environment. Furthermore, the `CapabilitiesResponse` schema currently lacks a `client_events_enabled` field, preventing clients from detecting whether client events are enabled without attempting publication.

---

## 1. Environment Variable Read

In `server/src/config.rs` (line 1088), the configuration manager reads the environment variable:

- **Primary Var / Rename**: `SOCKUDO_ENABLE_CLIENT_EVENTS` (and `WEBSOCKET_ENABLE_CLIENT_EVENTS` per rename task).
- **Struct Field**: `Config.sockudo_enable_client_events` (and `sockudo_config.enable_client_events`).
- **Type**: `bool`.
- **Default Value**: `true` (parsed via `var(...).unwrap_or_else(|_| "true".to_string()).parse().unwrap_or(true)`).

---

## 2. Configuration Propagation Path

Tracing `sockudo_enable_client_events` across `server/src/`:

1. `server/src/config.rs`: Loaded into `Config` struct.
2. `server/src/sockudo/mod.rs` (line 131): Mapped to `SockudoConfig.enable_client_events` during `Publisher::new(&config)` initialization.
3. `server/src/sockudo/publisher.rs` (line 60): Exposed via `pub fn enable_client_events(&self) -> bool`.
4. **Usage In Server Logic**: The server `Publisher` holds `enable_client_events`, but because client events are published directly by WebSocket client connections to Sockudo (bypassing the HTTP server), the field is currently unused in server-side publish paths.

---

## 3. Sockudo Container Configuration

A full repository audit for Docker and Sockudo container configuration files revealed:

- No `docker-compose.yml` or container definitions exist in the server repository.
- Sockudo operates as an independent external process/container.
- `enableClientMessages` on the Sockudo container is set via Sockudo's own configuration (`sockudo.json` or Sockudo environment variables).
- The server's `SOCKUDO_ENABLE_CLIENT_EVENTS` environment variable configures the server state, but does not configure the external Sockudo container.

---

## 4. App Creation Flow

- In the current V3 architecture, the server **does not** create or provision the Sockudo application via HTTP API on startup.
- Sockudo loads app credentials (`app_id`, `app_key`, `app_secret`, `enableClientMessages`) directly from its own deployment configuration.

---

## 5. Capabilities State

Inspection of `CapabilitiesResponse` in `docs/openapi.json` and `server/src/routes/capabilities.rs`:

- **Current Properties**: 43 fields including `websocket_url`, `sockudo_app_key`, `sockudo_channel_prefix`, `sessions_enabled`, `calling`, `model_hosting_enabled`.
- **Status of `client_events_enabled`**: **ABSENT**. The capabilities endpoint currently does not expose whether client events are enabled.

---

## 6. Client Event Type Whitelist

- Server Spec V3 §5.19 lists `client-typing.start` and `client-typing.stop` as allowed client event types.
- Sockudo itself permits client events on private/presence channels when `enableClientMessages: true` is configured on the app.
- Sockudo does not restrict client event names natively unless configured with event filters; server-side API endpoints do not sit in the client-to-Sockudo WebSocket path.

---

## 7. Rate Limiting and Payload Restrictions

- Client events are sent directly over WebSocket frames to Sockudo.
- The server does not inspect, proxy, or rate-limit client event payloads before they reach Sockudo. Sockudo's native message rate limits apply.

---

## 8. Failure Mode

If `enableClientMessages` is `false` on the Sockudo container:

- Sockudo silently drops or rejects client event frames (`client-*`) published by WebSocket clients.
- No server-side HTTP or database logs are generated.
- The client receives no error frame unless WebSocket client event error handling is explicitly listened to on the socket.
- Typing indicators silently fail to deliver to room peers.

---

## 9. Root Cause Answer

**Is the client team's concern valid?**
**YES.** The client team's concern is valid. Typing indicators rely on Sockudo client events (`client-typing.start` / `client-typing.stop`). If `enableClientMessages` is disabled in Sockudo, events fail silently. Because `CapabilitiesResponse` does not advertise `client_events_enabled`, clients cannot determine feature availability dynamically.

---

## 10. Recommendations

1. **Capabilities Field Addition**: Add `client_events_enabled: bool` to `CapabilitiesResponse` in `server/src/routes/capabilities.rs` (sourced from `config.sockudo_enable_client_events`) and annotate it in `docs/openapi.json`.
2. **Documentation & Deployment Alignment**: Ensure Sockudo deployment documentation explicitly specifies setting `enableClientMessages: true` in Sockudo's app configuration whenever `SOCKUDO_ENABLE_CLIENT_EVENTS=true` is set on the server.
