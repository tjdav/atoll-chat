# Step 0 Empirical Verification Report — Model Hosting V3 Alignment

**Date:** 2026-10-08
**Status:** Verification Complete — Zero Discrepancies Found
**Spec / Task References:** V3 Spec §5.27, §8.1, §8.1.3, §8.1.4, §8.3, §9, §14.8; V2 Tasks 41a, 41b, 39b

## Summary

This empirical report reconciles the current repository implementation of model hosting against Server Specification V3.0.3 and the established canonical facts from V2 Tasks 41a, 41b, and 39b.

The verification confirms that the current codebase fully matches Server Specification V3.0.3 and all established canonical V2 facts. No V3/V2 discrepancies or code gaps were identified. This task is a **verification-only task**.

---

## 16-Item Verification Checklist

### 1. Current Model Hosting Config Vars
- `MODEL_HOSTING_ENABLED` (`bool`, default `true`)
- `MODEL_HOSTING_MODE` (`local`, `external`, or `proxy`, default `local`)
- `MODEL_EXTERNAL_BASE_URL` (`Option<String>`, required in `external` and `proxy` modes, validated `https://` in production)
- `MODEL_STORAGE_PATH` (`PathBuf`, default `/data/models`)
- `STT_MODELS_PATH` (`PathBuf`, default `/data/models/stt`)
- `TTS_MODELS_PATH` (`PathBuf`, default `/data/models/tts`)
- `STT_DEFAULT_MODEL` (`String`, default `moonshine-tiny`)
- `TTS_DEFAULT_MODEL` (`String`, default `supertonic-3`)
- `RATE_MODEL_DOWNLOAD_PER_MIN` (`u32`, default `30`)
- `BACKUP_INCLUDE_MODELS` (`bool`, default `false`)

**Comparison against V3 §5.27:** 100% Match. All environment variables, defaults, ranges, and startup validations match V3 §5.27.

---

### 2. Current File-Serving Handlers
- **Paths:** `GET /models/stt/v1/:model_id/:version/:filename` and `GET /models/tts/v1/:model_id/:version/:filename`
- **Auth:** None (public).
- **Response Headers:** `Cache-Control: public, max-age=31536000, immutable`, `Content-Type: application/octet-stream`, `ETag: "<sha256>"`, `Accept-Ranges: bytes`, `Content-Length`.
- **ETag Derivation:** Quoted SHA-256 hash taken directly from model manifest entry (`format!("\"{}\"", model_file.sha256)`).
- **Range Handling:** Single range `bytes=N-M` returns HTTP `206 Partial Content` with `Content-Range`. Multi-range `bytes=a-b,c-d` returns HTTP `416 Range Not Satisfiable`.
- **404 / 400 Behavior:** Returns HTTP `404 Not Found` (`{"error": "model_not_found"}`) when disabled or when model/file is missing. Returns HTTP `400 Bad Request` (`{"error": "invalid_filename"}`) if filename contains characters outside `[A-Za-z0-9._-]` or contains path traversal segments (`..`, `/`, `\`).

**Comparison against V3 §8.1.3 and Task 41a:** 100% Match.

---

### 3. Current Manifest Endpoint
- **Path:** `GET /models/manifest.json`
- **Auth:** None (public).
- **Response Shape:** Combined JSON `{ "stt": { "default_model": "...", "base_url": "...", "models": [...] }, "tts": { "default_model": "...", "base_url": "...", "models": [...] } }`.
- **Manifest Schema:** `schema_version == 1`, `models[]` with `id`, `version`, `size_bytes`, `files[]` with `name`, `size_bytes`, `sha256`.
- **Headers:** `Cache-Control: public, max-age=3600`, `Content-Type: application/json`.

**Comparison against V3 §8.1.4 and Task 41a:** 100% Match.

---

### 4. Current Capabilities Fields
- **Seven Model Fields in `GET /capabilities`:**
  1. `model_hosting_enabled` (`bool`)
  2. `model_hosting_mode` (`string`)
  3. `stt_models_base_url` (`string`)
  4. `stt_default_model` (`string`)
  5. `tts_models_base_url` (`string`)
  6. `tts_default_model` (`string`)
  7. `tts_models` (`array` of `TtsCapabilityModelView` with `id`, `version`, `languages`, `voices`)
- **Disabled-State Invariants (Task 39a):** All top-level keys remain present when `MODEL_HOSTING_ENABLED=false`. `model_hosting_enabled` reports `false`, `model_hosting_mode` reports `"local"`, base URLs report constructed URLs, and `tts_models` reports `[]`.

**Comparison against V3 §8.1 and Task 39a:** 100% Match.

---

### 5. Current Mode Implementation Matrix
| Mode | Routes Registered | Base URL Source | Manifest Source |
|---|---|---|---|
| `local` | Yes (`/models/...`) | `{APP_URL}/models/...` | Local disk manifest (`{STT/TTS_MODELS_PATH}/manifest.json`) |
| `external` | **No** (404) | `{MODEL_EXTERNAL_BASE_URL}/...` | Remote URL `{MODEL_EXTERNAL_BASE_URL}/manifest.json` (cached 1h) |
| `proxy` | Yes (`/models/...`) | `{APP_URL}/models/...` | Local disk manifest; files fetched on demand to local disk |

**Comparison against Task 41b:** 100% Match.

---

### 6. Current External Manifest Cache
- **TTL:** 1 hour (`MANIFEST_TTL = 3600s`).
- **Network Failure Behavior:** When a background refresh or admin reload fails due to network or validation errors, the cache retains the previously valid cached manifest without dropping service or corrupting state.

**Comparison against Task 41b:** 100% Match.

---

### 7. Current Proxy Mode Cache
- **Cache Hit:** Serves directly from local disk at `{KIND_MODELS_PATH}/{model_id}/{version}/{filename}`.
- **Cache Miss:** Fetches full file from `{MODEL_EXTERNAL_BASE_URL}/{kind}/v1/{model_id}/{version}/{filename}` to an atomic temporary file (`{filename}.tmp.<pid>.<nanos>`) in target directory.
- **SHA-256 Verification:** Calculates SHA-256 during stream download and verifies against manifest `sha256` and `size_bytes`.
- **Failure Cleanup:** On mismatch or network error, temp file is deleted immediately, error recorded in a 30-second failure cache, and HTTP `502 Bad Gateway` (`{"error": "model_fetch_failed"}`) returned. On success, temp file is atomically renamed to destination.
- **Range Request Handling:** Range requests on cache miss fetch the full file into local cache first, then serve partial content from local disk.

**Comparison against Task 41b:** 100% Match.

---

### 8. Current Admin Reload Endpoint
- **Path:** `POST /api/v1/admin/models/reload`
- **Behavior per Mode:**
  - `local` & `proxy`: Re-reads and validates local disk manifests. On error, preserves previous manifests and returns HTTP `400 Bad Request` (`{"error": "invalid_model_manifest"}`).
  - `external`: Forces re-fetch (`fetch_manifest(true)`) of `{MODEL_EXTERNAL_BASE_URL}/manifest.json`. On network error, returns HTTP `502 Bad Gateway`; on validation error, returns HTTP `400 Bad Request`.
- **Audit Log:** Writes `model.manifest_reload` audit entry with metadata `{ "mode": "...", "stt_models": N, "tts_models": M }`.

**Comparison against V3 §8.3 and Tasks 41a/41b:** 100% Match.

---

### 9. Current CLI `server models verify`
- **Flags:** `--json`, `--kind <stt|tts|all>`, `--quiet`.
- **Exit Codes:**
  - `0`: Success (all model files verified against manifest SHA-256 hashes).
  - `1`: Negative outcome (missing files or SHA-256/size mismatch).
  - `2`: Usage/Config error (missing or unparseable local manifest).
- **JSON Output:** Structured report containing `status`, `total_files`, `verified_files`, `failed_files`, and details array.

**Comparison against V3 §9 and Task 39b:** 100% Match.

---

### 10. Current CLI `server models fetch`
- **Flags:** `--from <url>`, `--kind <stt|tts|all>`, `--json`, `--jobs <N>`, `--force`.
- **Exit Codes:**
  - `0`: Success (all model files fetched or already present).
  - `1`: Fetch/verification failure (network error or SHA-256/size mismatch).
  - `2`: Invalid flags, production `http://` URL, or missing local manifest.
- **Download Semantics:** Bounded async concurrency (`1..=8` jobs), downloads to atomic temp files, verifies size and SHA-256, renames. Skips valid existing files unless `--force` is specified.

**Comparison against V3 §9 and Task 39b:** 100% Match.

---

### 11. Current Rate Limit
- **File-Serving Routes:** Enforced via `RateLimitKey::ModelDownload { ip }` (`RATE_MODEL_DOWNLOAD_PER_MIN`, default `30` per IP).
- **Manifest Endpoint:** `GET /models/manifest.json` is explicitly exempt from rate limiting to allow client polls without quota penalty.

**Comparison against V3 §5.6 and Task 41a:** 100% Match.

---

### 12. Current Cache Headers
- **File Serving:** `Cache-Control: public, max-age=31536000, immutable`.
- **Manifest Endpoint:** `Cache-Control: public, max-age=3600`.

**Comparison against V3 §8.1.3 and §8.1.4:** 100% Match.

---

### 13. Current External Mode Base URL
- **Source:** `MODEL_EXTERNAL_BASE_URL`. Used in capabilities (`stt_models_base_url`, `tts_models_base_url`).
- **Lazy Fetch:** Base URL is not fetched at server startup. Fetched on demand when capabilities or admin reload is requested.

**Comparison against Task 41b:** 100% Match.

---

### 14. Current Voice Metadata Source
- **Path:** `{TTS_MODELS_PATH}/{model_id}/{version}/voices.json`.
- **Fallback:** If `voices.json` is missing or malformed, falls back to `languages: ["*"]` and `voices: []`.

**Comparison against Task 41a:** 100% Match.

---

### 15. Existing Test Suite
- `server/tests/model_hosting.rs` (9 test cases) — `transport` batch
- `server/tests/model_hosting_modes.rs` (6 test cases) — `transport` batch
- `server/tests/cli_models.rs` (8 test cases) — `operations` batch

All 23 test cases pass under `make -C server test-transport` and `make -C server test-operations`.

---

### 16. V2 Remnants
- **Code Audit Result:** Zero V2 remnants found.
- The code does not assume a single mode, does not fetch external manifests at startup, does not cache credentials, and does not write plaintext to logs.

---

## Verification Conclusion

All sixteen items conform strictly to Server Specification V3.0.3 and the established canonical facts from V2 Tasks 41a, 41b, and 39b. No spec amendments or production code changes are required.
