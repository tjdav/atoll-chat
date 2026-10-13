# Empirical Verification Report — Key Transparency Endpoints OpenAPI Annotations

**Date:** October 12, 2024
**Scope:** Verification of current codebase state for Key Transparency domain OpenAPI annotation task.

---

### 1. Current ApiDoc Struct
- **Location:** `server/src/openapi.rs`
- **Paths List:** Currently contains 49 route path declarations across 37 unique path items (Public, User, Messaging, and Bots domains).
- **Schemas List:** Currently contains 56 derived schemas in `components(schemas(...))`.
- **Bots Domain Confirmation:** Bots-domain annotations from the prior task are fully present (e.g., `/api/v1/bots`, `/api/v1/bots/{id}`, `BotView`, `CreateBotReq`, `RotateBotKeysReq`, etc.).

### 2. Current Error Response Schema
- **Location:** `server/src/error.rs` (`ErrorResponse`)
- **Status:** Derived with `ToSchema` and included in `ApiDoc` components schemas. Expresses standard V3 error format `{ "error": "...", "message": "..." }`.

### 3. Current Bearer Security Scheme
- **Location:** `server/src/openapi.rs` (`SecurityAddon`)
- **Status:** Configured under name `bearer_auth` with `HttpAuthScheme::Bearer` and bearer format `session_token`.

### 4. Current KT Endpoint Handlers
- **GET /kt/user/:id** (`/api/v1/kt/user/{id}`)
  - Location: `server/src/routes/key_transparency.rs` -> `get_user_kt_handler`
  - Response Type: `UserKtResponse`
  - Auth Requirement: `_auth: AuthUser` (User session token Bearer auth required)
- **GET /kt/bot/:id** (`/api/v1/kt/bot/{id}`)
  - Location: `server/src/routes/key_transparency.rs` -> `get_bot_kt_handler`
  - Response Type: `BotKtResponse`
  - Auth Requirement: `resolve_caller` (User session token or Bot token accepted)
- **GET /kt/bot/:id/history** (`/api/v1/kt/bot/{id}/history`)
  - Location: `server/src/routes/key_transparency.rs` -> `get_bot_kt_history_handler`
  - Response Type: `BotKtHistoryResponse`
  - Auth Requirement: `resolve_caller` (User session token or Bot token accepted)
- **GET /kt/snapshot** (`/api/v1/kt/snapshot`)
  - Location: `server/src/routes/key_transparency.rs` -> `get_kt_snapshot_handler`
  - Response Type: `KtSnapshotResponse`
  - Auth Requirement: `_auth: AuthUser` (User session token Bearer auth required)

### 5. Current KT Response Types
- **`UserKtResponse`**:
  - `user_id: String`
  - `leaf_index: i64`
  - `identity_pubkey: String`
  - `inclusion_proof: Vec<String>`
  - `tree_head: Value` (to be typed as `KtTreeHead`)
  - `auditor_signatures: Vec<Value>` (to be typed as `Vec<KtAuditorSignature>`)
- **`BotKtResponse`**:
  - `bot_id: String`
  - `leaf_index: i64`
  - `bot_identity_pubkey: String`
  - `bot_command_pubkey: String`
  - `identity_pubkey: String`
  - `inclusion_proof: Vec<String>`
  - `tree_head: Value` (to be typed as `KtTreeHead`)
  - `auditor_signatures: Vec<Value>` (to be typed as `Vec<KtAuditorSignature>`)
- **`BotKtHistoryResponse`**:
  - `bot_id: String`
  - `entries: Vec<BotKtHistoryEntry>` where `BotKtHistoryEntry` has `leaf_index: i64`, `bot_identity_pubkey: String`, `bot_command_pubkey: String`, `identity_pubkey: String`, `added_at: String`
- **`KtSnapshotResponse`**:
  - `tree_size: i64`
  - `root_hash: String`
  - `created_at: DateTime<Utc>`
  - *Note:* In accordance with §8.11.4, no `signature` field is present in `KtSnapshotResponse`.

### 6. Current Inclusion Proof Representation
- **Serialization:** `Vec<String>` where each string is a 32-byte Merkle tree node hash, base64url-encoded (`URL_SAFE_NO_PAD.encode(h)`).
- **Schema Representation:** Flat, depth-bounded, and finite array of byte strings (`type: array, items: { type: string, format: byte }`). Non-recursive.

### 7. Current Tree Head Representation
- **Serialization:** Currently inline `serde_json::Value` (`json!({ ... })`).
- **Fields:** `id: Option<String>`, `tree_size: i64`, `root_hash: String` (base64url encoded 32-byte hash), `signature: Option<String>` (base64url encoded signature bytes), `created_at: DateTime<Utc>`.
- **Option B Implementation:** Replaced inline `Value` with concrete `KtTreeHead` struct deriving `ToSchema` and `Serialize`:
  ```rust
  #[derive(Serialize, ToSchema)]
  pub struct KtTreeHead {
      pub id: Option<String>,
      pub tree_size: i64,
      #[schema(value_type = String, format = Binary, description = "32-byte Merkle tree root hash, base64url encoded. Reference: §7.11")]
      pub root_hash: String,
      #[schema(value_type = Option<String>, format = Binary, description = "Server signature over tree head, base64url encoded.")]
      pub signature: Option<String>,
      pub created_at: DateTime<Utc>,
  }
  ```

### 8. Current Auditor Signatures Representation
- **Serialization:** Currently `Vec<Value>` (hardcoded to `Vec::new()`).
- **Option B Implementation:** Replaced inline `Value` with concrete `KtAuditorSignature` struct deriving `ToSchema` and `Serialize`:
  ```rust
  #[derive(Serialize, ToSchema)]
  pub struct KtAuditorSignature {
      pub auditor_id: String,
      #[schema(value_type = String, format = Binary, description = "Auditor signature over tree head, base64url encoded.")]
      pub signature: String,
  }
  ```

### 9. Current Path Parameter Naming
- Router definitions in `server/src/lib.rs` use `{id}` parameter syntax (e.g., `/kt/user/{id}`, `/kt/bot/{id}`). Utoipa's path attributes will use `{id}` matching the router.

### 10. Current Auth Mode
- `GET /kt/user/{id}`: Requires session token (`AuthUser`).
- `GET /kt/snapshot`: Requires session token (`AuthUser`).
- `GET /kt/bot/{id}`: Accepts session token or bot token (`resolve_caller`).
- `GET /kt/bot/{id}/history`: Accepts session token or bot token (`resolve_caller`).
- All 4 endpoints require authentication and declare `security(("bearer_auth" = []))`.

### 11. Current Ciphertext & Public Key Field Conventions
- Public key fields (`identity_pubkey`, `bot_identity_pubkey`, `bot_command_pubkey`, `command_pubkey`) are base64url-encoded public key bytes.
- Annotated as `#[schema(value_type = String, format = Binary, description = "...")]` (or `value_type = Option<String>`), with descriptions explicitly noting base64url encoding and key format.
- Merkle `root_hash` annotated as `#[schema(value_type = String, format = Binary, description = "32-byte Merkle tree root hash, base64url encoded. Reference: §7.11")]`.

### 12. Current username_token Exclusion
- Confirmed that `UserKtResponse` struct omits `username_token` per §12 and §8.11.1.
- Documented in `get_user_kt_handler` operation description: `"See §8.11.1. Note: username_token is excluded from response per §12."`

### 13. Current Tests
- `server/tests/openapi_generation.rs` validates OpenAPI generation, schema completeness, path items count (currently 37), bearer auth presence, and JSON round-tripping.
- Expected path count will increase from 37 to 41 path items.

### 14. V2 Remnants
- No conflicting or competing response definitions exist. Response types in `server/src/routes/key_transparency.rs` are clean and isolated.
