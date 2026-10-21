# Verification Report: Rename SOCKUDO_* to WEBSOCKET_* and PUSHER_* (Rename Task 1)

**Date:** March 2026
**Task:** Rename Task 1 of 2 — Config and Internal Rename (`SOCKUDO_*` → `WEBSOCKET_*` and `PUSHER_*`)

---

## 1. Env Var Inventory

Searching `server/src/` for target environment variables:

| Env Var String | File & Line Number | Context |
|---|---|---|
| `SOCKUDO_URL` | `server/src/routes/ready.rs:49` | Readiness check reads `SOCKUDO_URL` env var |
| `SOCKUDO_URL` | `server/src/config.rs:1059` | `Config::from_env` reads `SOCKUDO_URL` |
| `SOCKUDO_URL` | `server/src/config.rs:1063` | `anyhow::bail!("SOCKUDO_URL must be set in production mode")` |
| `SOCKUDO_PUBLIC_URL` | `server/src/config.rs:1092` | `Config::from_env` reads `SOCKUDO_PUBLIC_URL` |
| `SOCKUDO_APP_ID` | `server/src/routes/ready.rs:54` | Readiness check fallback reads `SOCKUDO_APP_ID` |
| `SOCKUDO_APP_ID` | `server/src/config.rs:1070` | `Config::from_env` reads `SOCKUDO_APP_ID` |
| `SOCKUDO_APP_KEY` | `server/src/config.rs:1076` | `Config::from_env` reads `SOCKUDO_APP_KEY` |
| `SOCKUDO_APP_SECRET` | `server/src/config.rs:1082` | `Config::from_env` reads `SOCKUDO_APP_SECRET` |
| `SOCKUDO_AUTH_PATH` | N/A (absent) | Added as `WEBSOCKET_AUTH_PATH` defaulting to `"/sockudo/auth"` |
| `SOCKUDO_ENABLE_CLIENT_EVENTS` | `server/src/config.rs:1088` | `Config::from_env` reads `SOCKUDO_ENABLE_CLIENT_EVENTS` |

---

## 2. Config Field Inventory

In `server/src/config.rs`, the fields reading these env vars, their types, defaults, and chosen internal field renames:

| Original Env Var | Renamed Env Var | Struct Field Name | Type | Default Value |
|---|---|---|---|---|
| `SOCKUDO_URL` | `WEBSOCKET_URL` | `websocket_url` | `String` | `"http://localhost:6001"` (prod requires explicit) |
| `SOCKUDO_PUBLIC_URL` | `WEBSOCKET_PUBLIC_URL` | `websocket_public_url` | `Option<String>` | `None` |
| `SOCKUDO_APP_ID` | `PUSHER_APP_ID` | `pusher_app_id` | `String` | `"chat"` |
| `SOCKUDO_APP_KEY` | `PUSHER_APP_KEY` | `pusher_app_key` | `String` | `"auto"` |
| `SOCKUDO_APP_SECRET` | `PUSHER_APP_SECRET` | `pusher_app_secret` | `String` | `"auto"` |
| `SOCKUDO_AUTH_PATH` | `WEBSOCKET_AUTH_PATH` | `websocket_auth_path` | `String` | `"/sockudo/auth"` |
| `SOCKUDO_ENABLE_CLIENT_EVENTS` | `WEBSOCKET_ENABLE_CLIENT_EVENTS` | `websocket_enable_client_events` | `bool` | `true` |

*Note on Internal Field Names:* Config struct field names are updated to match the protocol-neutral (`websocket_*`) and protocol-specific (`pusher_*`) naming conventions for consistent codebase clarity.

---

## 3. server_config Key Inventory

Searching `server/src/` for `sockudo_app_key` and `sockudo_app_secret` key string literals:

| Key Literal | File & Line | Context / Function |
|---|---|---|
| `'sockudo_app_key'` | `server/src/sockudo/mod.rs:57` | `SELECT value FROM server_config WHERE key = 'sockudo_app_key'` in `load_or_initialize` |
| `'sockudo_app_secret'` | `server/src/sockudo/mod.rs:61` | `SELECT value FROM server_config WHERE key = 'sockudo_app_secret'` in `load_or_initialize` |
| `'sockudo_app_key'` | `server/src/sockudo/mod.rs:80` | `INSERT INTO server_config (key, value, is_secret) VALUES ('sockudo_app_key', ?, 0)...` |
| `'sockudo_app_secret'` | `server/src/sockudo/mod.rs:88` | `INSERT INTO server_config (key, value, is_secret) VALUES ('sockudo_app_secret', ?, 1)...` |
| `"sockudo_app_key"` | `server/src/config_ops.rs:17` | `export_server_config` / `import_server_config` white-list table |
| `"sockudo_app_secret"` | `server/src/config_ops.rs:18` | `export_server_config` / `import_server_config` white-list table |

All 6 occurrences are renamed to `'pusher_app_key'` and `'pusher_app_secret'` respectively.

---

## 4. Rate Limit Inventory

- **Env Var:** `RATE_WEBSOCKET_AUTH_PER_MIN` (renamed from `RATE_SOCKUDO_AUTH_PER_MIN`) added to `RateLimitConfig` with default `300`.
- **Variant:** `RateLimitKey::WebSocketAuth { identity: String }` added to `RateLimitKey` in `server/src/rate_limit.rs`.
- **Key Prefix / Format:** `websocket_auth:{identity}:min:{boundary}` enforced for rate limiting channel auth requests.

---

## 5. Audit Action Inventory

- **Audit Constant:** `pub const WEBSOCKET_CONFIG_GENERATE: &str = "websocket.config_generate";` defined in `server/src/audit.rs`.
- **Logging:** Logged when first-boot auto-generation generates random app keys and secrets in `load_or_initialize`.

---

## 6. Documentation and Deployment Files

Searched repository (excluding `server/src/` and `server/tests/`):

| File Path | Original Strings | Planned Update |
|---|---|---|
| `server/.env.example` | `SOCKUDO_URL`, `SOCKUDO_APP_ID`, `SOCKUDO_APP_KEY`, `SOCKUDO_APP_SECRET` | Renamed to `WEBSOCKET_URL`, `PUSHER_APP_ID`, `PUSHER_APP_KEY`, `PUSHER_APP_SECRET`. Added comment explaining Pusher v7 protocol names. |
| `server/README.md` | `SOCKUDO_APP_KEY`, `SOCKUDO_APP_SECRET`, `SOCKUDO_URL` | Renamed configuration references to `PUSHER_APP_KEY`, `PUSHER_APP_SECRET`, `WEBSOCKET_URL`. |

---

## 7. Test Inventory

Searching `server/tests/` for configuration and key references:

| Test File | Test Batch | Reference / Usage |
|---|---|---|
| `server/tests/sockudo.rs` | `sockudo` | Constructs `Config` with app key/secret, tests DB key persistence, tests rate limits & capabilities |
| `server/tests/capabilities_audit.rs` | `capabilities` | Asserts white-listed config keys in `config_ops` |
| `server/tests/common/mod.rs` | N/A (shared helper) | Initializes test app state and `Publisher` from `Config` fields |
| `server/tests/end_to_end_walkthrough.rs` | `operations` | End-to-end continuous integration walkthrough building test config |
| `server/tests/devices.rs`, `login.rs`, `pending_removes.rs`, etc. | Various | Struct initialization sets `cfg.sockudo_app_key` / `cfg.sockudo_app_secret` |

---

## 8. Backward Compatibility

- **Deployment Status:** No production deployments exist. Per project state and guidelines, no backward compatibility layer or fallback for old env vars is provided.
- **Breaking Change:** Environments using old `SOCKUDO_*` env vars will fail fast on missing required variables in production or fall back to defaults in development mode.

---

## 9. Startup Behavior on Missing Env Vars

- **Production Mode (`APP_ENV=production`):** Missing `WEBSOCKET_URL` causes `Config::from_env()` to return `Err("WEBSOCKET_URL must be set in production mode")`, immediately refusing server boot.
- **Non-Production Mode (`APP_ENV=development`):** Missing `WEBSOCKET_URL` defaults to `"http://localhost:6001"`.
- **Default Fallbacks:** `PUSHER_APP_ID` defaults to `"chat"`; `PUSHER_APP_KEY` and `PUSHER_APP_SECRET` default to `"auto"`.
- **Preservation:** The rename maintains identical startup behavior and error messaging under the new variable names.
