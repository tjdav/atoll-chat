# Step 0 — Empirical Verification Report: Enable Router-vs-OpenAPI Test

## 1. Current Test State
Inspected `server/tests/openapi_generation.rs`:
- **Function carrying `#[ignore]`:** `test_router_and_openapi_paths_match_one_to_one` (line 424).
  - Attribute: `#[ignore = "Pending OpenAPI annotation sweep (9 paths currently missing from OpenAPI)"]`.
- **Execution with `--ignored`:**
  - Running `cargo test --manifest-path server/Cargo.toml --test openapi_generation test_router_and_openapi_paths_match_one_to_one -- --ignored --nocapture` outputs:
    `test test_router_and_openapi_paths_match_one_to_one ... ok`
    `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out`
  - Zero missing paths reported (test passes cleanly).
- **Other test functions in `server/tests/openapi_generation.rs`:**
  1. `test_openapi_doc_validity`
  2. `test_openapi_cli_subcommand_out_flag`
  3. `test_openapi_cli_default_invocation`

## 2. Prior Counts from Task D
From Task D's Step 0 report (`verification/annotate-admin-and-roles/report.md`):
- **Missing path count before Task D:** 9 missing paths (`/api/v1/admin/altcha/rotate`, `/api/v1/admin/audit`, `/api/v1/admin/backups`, `/api/v1/admin/config`, `/api/v1/admin/invites`, `/api/v1/admin/invites/{id}`, `/api/v1/admin/limits`, `/api/v1/admin/vapid/rotate`, `/api/v1/roles`).
- **Missing path count after Task D's annotations:** 0 missing paths.

## 3. Current `docs/openapi.json` Path Count
- `jq -r '.paths | keys[]' docs/openapi.json | wc -l`: **121** unique path keys.

## 4. Current Router Path Count
- Extracted by `test_router_and_openapi_paths_match_one_to_one` from `server/src/lib.rs`: **121** unique path keys.

## 5. Diff Analysis
- **Router-only paths:** 0 (`router_only count: 0`).
- **OpenAPI-only paths:** 0 (`openapi_only count: 0`).
- **Confirmation:** The router paths and OpenAPI path items match 1:1 at exactly 121 path keys.

## 6. Batch Assignment
- File `openapi_generation.rs` is assigned to the `operations` batch in `server/tests/batch-manifest.toml`.

## 7. Prior Test Run Behavior
- Running `cargo test --manifest-path server/Cargo.toml --test openapi_generation -- --list`:
  - `test_openapi_cli_default_invocation: test`
  - `test_openapi_cli_subcommand_out_flag: test`
  - `test_openapi_doc_validity: test`
  - `test_router_and_openapi_paths_match_one_to_one: test`
- Running standard `cargo test --manifest-path server/Cargo.toml --test openapi_generation` (without `--ignored`):
  - `test test_router_and_openapi_paths_match_one_to_one ... ignored, Pending OpenAPI annotation sweep (9 paths currently missing from OpenAPI)`
  - `test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out`
