# Step 0 — Empirical Verification Report: OpenAPI File Generation

**Date:** 2026-10-12
**Task Track:** Developer Tooling
**Status:** Verification Complete

---

### 1. Current Axum Version
- **Axum Version in `Cargo.toml`:** `0.8` (`axum = { version = "0.8", features = ["multipart"] }`).
- **Matching utoipa Version:** `utoipa = { version = "5.3", features = ["axum"] }` (or `utoipa = "5.3"` / `5.x` which supports Axum 0.8 / standard OpenApi derive). We will use `utoipa = { version = "5.3" }` in `Cargo.toml`. `utoipa-axum` is optional and not required for a file-only derive workflow.

---

### 2. Current Cargo.toml Dependency List
- Dependencies currently in `server/Cargo.toml`:
  - `axum = { version = "0.8", features = ["multipart"] }`
  - `serde = { version = "1", features = ["derive"] }`
  - `serde_json = "1"`
  - `clap = { version = "4", features = ["derive"] }`
  - ... (other dependencies: `sqlx`, `tokio`, `tower`, `opaque-ke`, `voprf`, `altcha`, etc.)
- **Confirmation:** No existing `utoipa` or `schemars` dependencies exist in `Cargo.toml`.

---

### 3. Current CLI Structure
- **CLI Dispatcher Location:** `server/src/cli.rs` and `server/src/main.rs`.
- **Parsing & Registration:** Uses `clap` derive macro.
  - `Cli` struct in `server/src/cli.rs` derives `Parser` with subcommands enum `Command`.
  - Nested subcommands are defined as separate enums (e.g. `KtCommand`, `ModelsCommand`, `ConfigCommand`, `SessionTypesCommand`).
- **Dispatch Pattern for New Subcommand:**
  - Add variant to `Command` enum in `server/src/cli.rs`:
    ```rust
    /// OpenAPI schema generator operator subcommands
    Openapi {
        #[command(subcommand)]
        command: OpenapiCommand,
    },
    ```
  - Define `OpenapiCommand` enum:
    ```rust
    #[derive(Subcommand, Debug)]
    pub enum OpenapiCommand {
        /// Generate OpenAPI specification JSON file
        Generate {
            /// Output path for openapi.json
            #[arg(long, default_value = "docs/openapi.json")]
            out: PathBuf,
        },
    }
    ```
  - Add execution logic function `run_openapi_generate(out: PathBuf)` in `server/src/cli.rs` or `server/src/openapi.rs`.
  - Handle dispatch in `main()` in `server/src/main.rs`.

---

### 4. Current Route for `GET /health`
- **File:** `server/src/routes/health.rs`
- **Handler Signature:** `pub async fn handler() -> impl IntoResponse`
- **Response Type:** `Json(HealthResponse)` where:
  ```rust
  #[derive(Serialize, utoipa::ToSchema)]
  pub struct HealthResponse {
      status: String,
  }
  ```

---

### 5. Current Route for `GET /ready`
- **File:** `server/src/routes/ready.rs`
- **Handler Signature:** `pub async fn handler(State(state): State<AppState>) -> Response`
- **Response Type:** Returns `(StatusCode, Json(ReadinessResponse)).into_response()` where:
  ```rust
  #[derive(Serialize, utoipa::ToSchema)]
  pub struct ReadinessResponse {
      pub status: String,
      pub checks: BTreeMap<String, String>,
  }
  ```

---

### 6. Current Route for `GET /capabilities`
- **File:** `server/src/routes/capabilities.rs`
- **Handler Signature:** `pub async fn handler(State(state): State<AppState>) -> impl IntoResponse`
- **Response Type:** Typed struct `Json(CapabilitiesResponse)`.
- **Note:** Per prompt instructions (Item 5), even though `CapabilitiesResponse` is a typed struct with ~50 fields, for GET /capabilities in OpenAPI pilot, if untyped object treatment is allowed or if deriving `ToSchema` is additive, we can derive `ToSchema` or annotate response body. Deriving `ToSchema` on `CapabilitiesResponse`, `SessionTypeCapView`, `TtsCapabilityModelView`, and `AltchaCapView` is additive and does not change wire behavior.

---

### 7. Current Route for `GET /users/me`
- **File:** `server/src/routes/users.rs`
- **Handler Signature:** `pub async fn get_me(State(state): State<AppState>, auth: AuthUser) -> Result<Json<UserProfileResponse>, ApiError>`
- **Response Type:** `Json(UserProfileResponse)` where `UserProfileResponse` carries user profile data and `UserLimitsResponse`.
- **Auth Middleware:** `AuthUser` extractor enforces Bearer session token authentication (`Authorization: Bearer <session_token>`).

---

### 8. Current Docs Directory
- **State:** `docs/` directory at repo root does not exist currently.
- **Action:** Subcommand `openapi generate` creates parent directory `docs/` automatically if missing when writing `docs/openapi.json`.

---

### 9. Current CI Configuration
- **State:** No `.github/workflows` directory exists in repo root.
- **Makefile Target:** `server/Makefile` contains batch test targets (`make check-batches`, `make test-all`, etc.).
- **Action:** We will add an `openapi-check` target (or similar) to `server/Makefile` that runs the OpenAPI generator and verifies `git diff --exit-code docs/openapi.json` to check for staleness.

---

### 10. Current Test Harness for CLI Subcommands
- **Example Files:** `server/tests/cli_models.rs`, `server/tests/cli_migrate.rs`, `server/tests/cli_rotate.rs`, `server/tests/cli_storage_migrate.rs`.
- **Batch Assignment:** `operations` batch in `server/tests/batch-manifest.toml` handles CLI subcommand tests.
- **Pattern:** `server/tests/openapi_generation.rs` will be added to the `operations` batch in `server/tests/batch-manifest.toml` and `server/Makefile`.
- **Invocation in Tests:** Tests call the subcommand functions directly (e.g. `run_openapi_generate(out_path)`) or invoke CLI parsing functions, verifying file creation, validity, and contents.

---

### 11. Existing API Documentation
- **Confirmation:** No hand-written OpenAPI or Swagger file (`openapi.json`, `openapi.yaml`, `swagger.json`) exists in the repo.

---

### 12. V2 Remnants
- **Confirmation:** No code paths or docs artifacts assume or conflict with OpenAPI schemas.

---

### Decision Summary
1. **utoipa Version:** `utoipa = { version = "5.3", features = [] }` in `server/Cargo.toml`.
2. **OpenAPI File Path:** Default `docs/openapi.json`.
3. **CLI Subcommand:** `server openapi generate [--out <path>]`.
4. **Staleness Check:** Makefile target `openapi-check` in `server/Makefile`.
5. **Test Batch:** `openapi_generation.rs` assigned to `operations` batch in `server/tests/batch-manifest.toml` and `server/Makefile`.
