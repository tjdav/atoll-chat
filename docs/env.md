# Environment Configuration Documentation

This document describes all build-time and run-time environment variables used across the Atoll Chat application.

---

## Configuration Lifecycle

The project utilizes environment variables across two main lifecycles:

1. **Build-Time (Frontend Compiling):** Used during compilation of the static site via [coralite.config.js](/coralite.config.js). These variables are statically injected into the client bundle or used to output static configurations (e.g., Deep Linking manifests). Changing these values requires rebuilding the application.
2. **Run-Time (Backend / Push Services):** Read dynamically by the services during execution. This includes the PocketBase backend Goja hooks (`$os.getenv`) and the Node.js Push Worker daemon. Changing these values requires restarting the service.

---

## Local Development Configuration (.env)

A local environment configuration file named `.env` can be placed at the root of the project to define local overrides. This file is git-ignored (configured in [.gitignore](/.gitignore)).

Here is a template you can use for local development and deployment:

```env
# ==============================================================================
# SECTION 1: FRONTEND BUILD-TIME ONLY
# Set as Docker BUILD ARGUMENTS (or in .env during pnpm run build)
# Statically compiled into client JavaScript assets.
# ==============================================================================
ATOLL_POCKETBASE_URL=http://localhost:8090
ATOLL_APP_URL=http://localhost:3000

# LOCAL_ICE_SERVER=turn:127.0.0.1:3478
# ATOLL_NOTIFICATION_SOUND_DEBOUNCE_MS=1000
# ATOLL_MAX_SERVER_UPLOAD_SIZE_BYTES=26214400

# Mobile Deeplinking Manifests (Build-Time)
ATOLL_IOS_TEAM_ID=TEAMID1234
ATOLL_IOS_APP_ID=com.atoll.chat
ATOLL_ANDROID_PACKAGE_NAME=com.atoll.chat
ATOLL_ANDROID_CERT_FINGERPRINT=FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C

# ==============================================================================
# SECTION 2: FRONTEND & BACKEND DUAL-ROLE (BUILD-TIME + RUNTIME)
# MUST BE PASSED AS BOTH:
#   1) Docker BUILD ARGUMENT (so frontend JS embeds public key for push subscriptions)
#   2) Container RUNTIME ENV (so push-worker loads public key to sign VAPID headers)
# ==============================================================================
ATOLL_VAPID_PUBLIC_KEY=BG6jbL6oHXUyR8hntptF57uh1ZC229JFqe0t4moskBqFNFhN8nYrCUma47Vmlg7eL1NhmyO8BKznjpqTx_T-7XQ

# ==============================================================================
# SECTION 3: POCKETBASE BACKEND (RUNTIME ONLY)
# Set as Container RUNTIME ENVIRONMENT VARIABLES (read dynamically by Goja hooks)
# ==============================================================================
PORT=8080
ATOLL_ALLOWED_ORIGINS=*
ATOLL_TURN_SHARED_SECRET=REPLACE_THIS_WITH_A_LONG_RANDOM_STRING
ATOLL_TURN_EXPIRES_IN_SECONDS=3600
ATOLL_PUSH_WORKER_URL=http://127.0.0.1:3000
ATOLL_PUSH_WORKER_SECRET=ed1HN08ksc3jvmQyDRzcrBtwM*rrW!hsbSuWNHFvgdXUs%4A3!H0SMEdBdQ@W#h4
ATOLL_ALTCHA_SECRET=1Fp%pfd^*SB3^sWXb%J9Q0Brt^x17wa%PMdqA00F*1^kdZ2#FKhvjY%#f2E*tvdc

# PocketBase S3 Storage Config (Optional - Runtime Only)
ATOLL_S3_ENDPOINT=
ATOLL_S3_BUCKET=
ATOLL_S3_ACCESS_KEY=
ATOLL_S3_SECRET_KEY=
ATOLL_S3_REGION=us-east-1
ATOLL_S3_FORCE_PATH_STYLE=false

# PocketBase SMTP Mail Config (Optional - Runtime Only)
ATOLL_SMTP_ENABLED=false
ATOLL_SMTP_HOST=
ATOLL_SMTP_PORT=587
ATOLL_SMTP_USERNAME=
ATOLL_SMTP_PASSWORD=
ATOLL_SMTP_TLS=false
ATOLL_SMTP_AUTH_METHOD=PLAIN
ATOLL_SMTP_LOCAL_NAME=
ATOLL_SMTP_SENDER_NAME="Atoll Chat"
ATOLL_SMTP_SENDER_ADDRESS="noreply@atoll.chat"

# ==============================================================================
# SECTION 4: PUSH WORKER SERVICE (RUNTIME ONLY)
# ==============================================================================
ATOLL_VAPID_PRIVATE_KEY=your_private_key_here
ATOLL_VAPID_SUBJECT=mailto:admin@example.com
ATOLL_INTERNAL_POCKETBASE_URL=http://127.0.0.1:8080
```

---

## Environment Variable Categories & Lifecycles

### Summary Reference Table

| Category | Lifecycle Scope | Where to Configure in Docker / Coolify |
|----------|-----------------|----------------------------------------|
| **Category 1** | `[BUILD-TIME ONLY]` | Docker `ARG` / Build Arguments |
| **Category 2** | `[BUILD & RUNTIME]` | **BOTH** Docker Build Arguments **AND** Runtime Env Vars |
| **Category 3** | `[RUNTIME ONLY]` | Container Runtime Environment Variables |

---

### Detailed Variable Matrix

#### 1. Build-Time Variables (Frontend)

| Variable Name | Scope / Lifecycle | Default Value | Description | Used In / By |
|---------------|-------------------|---------------|-------------|--------------|
| `ATOLL_POCKETBASE_URL` | `[BUILD-TIME ONLY]` | `http://localhost:8090` | Base URL of the PocketBase database server. Defaults to `/` in Docker for relative api routing. | [coralite.config.js](/coralite.config.js), [pocketbasePlugin](/src/plugins/pocketbase.js) |
| `ATOLL_APP_URL` | `[BUILD-TIME ONLY]` | None | Absolute URL pointing to the frontend web application (used by background cryptographic workers and redirects). | [coralite.config.js](/coralite.config.js), [pocketbasePlugin](/src/plugins/pocketbase.js), [cryptoPlugin](/src/plugins/crypto-worker.js) |
| `ATOLL_VAPID_PUBLIC_KEY` | **`[BUILD & RUNTIME]`** | `BG6jbL6oHXUyR8...` | Valid 65-byte P-256 VAPID public key. Embedded into JS bundle at build-time for browser push subscriptions, and loaded at runtime by push-worker for VAPID headers. **Must be set as both Docker Build Arg AND Runtime Env.** | [coralite.config.js](/coralite.config.js), [pushPlugin](/src/plugins/push-plugin.js), [push-worker](/push-worker/index.js) |
| `LOCAL_ICE_SERVER` | `[BUILD-TIME ONLY]` | None | Overrides the Ice Server configuration for local WebRTC calls. | [coralite.config.js](/coralite.config.js), [configPlugin](/src/plugins/config-plugin.js), [webrtcPlugin](/src/plugins/web-rtc-plugin.js) |
| `ATOLL_NOTIFICATION_SOUND_DEBOUNCE_MS` | `[BUILD-TIME ONLY]` | `1000` | Minimum interval (in ms) required between playing notification sounds. | [coralite.config.js](/coralite.config.js), [configPlugin](/src/plugins/config-plugin.js) |
| `ATOLL_MAX_SERVER_UPLOAD_SIZE_BYTES` | `[BUILD-TIME ONLY]` | `26214400` (25MB) | Maximum file size allowed for direct server upload before switching to WebRTC P2P or triggering conditional video compression. | [coralite.config.js](/coralite.config.js), [configPlugin](/src/plugins/config-plugin.js) |
| `ATOLL_IOS_TEAM_ID` | `[BUILD-TIME ONLY]` | `TEAMID1234` | iOS Developer Team ID used to compile `apple-app-site-association`. | [deeplinkManifestPlugin](/src/plugins/deeplink-manifest-plugin.js) |
| `ATOLL_IOS_APP_ID` | `[BUILD-TIME ONLY]` | `com.atoll.chat` | iOS App Bundle ID used to compile `apple-app-site-association`. | [deeplinkManifestPlugin](/src/plugins/deeplink-manifest-plugin.js) |
| `ATOLL_ANDROID_PACKAGE_NAME` | `[BUILD-TIME ONLY]` | `com.atoll.chat` | Android package name used to compile `assetlinks.json`. | [deeplinkManifestPlugin](/src/plugins/deeplink-manifest-plugin.js) |
| `ATOLL_ANDROID_CERT_FINGERPRINT` | `[BUILD-TIME ONLY]` | `FA:C6:17:45:DC...` | SHA256 certificate fingerprint used to compile `assetlinks.json`. | [deeplinkManifestPlugin](/src/plugins/deeplink-manifest-plugin.js) |

---

#### 2. Backend Runtime Variables (PocketBase)

| Variable Name | Scope / Lifecycle | Default Value | Description | Used In / By |
|---------------|-------------------|---------------|-------------|--------------|
| `PORT` | `[RUNTIME ONLY]` | `8080` (or `8090` in dev) | Port that the PocketBase server listens on. | [Dockerfile](/Dockerfile) |
| `ATOLL_ALLOWED_ORIGINS` | `[RUNTIME ONLY]` | `*` | CORS allowed origins passed to PocketBase `--origins` flag. | [Dockerfile](/Dockerfile) |
| `ATOLL_TURN_SHARED_SECRET` | `[RUNTIME ONLY]` | `'REPLACE_THIS...'` | Shared key for signing WebRTC TURN relay credentials. | [turn_credentials.pb.js](/database/pb_hooks/turn_credentials.pb.js) |
| `ATOLL_TURN_EXPIRES_IN_SECONDS` | `[RUNTIME ONLY]` | `3600` | Expiry duration (TTL) for generated TURN credentials. | [turn_credentials.pb.js](/database/pb_hooks/turn_credentials.pb.js) |
| `ATOLL_TURN_URIS` | `[RUNTIME ONLY]` | None | Comma-separated list of STUN/TURN URIs (e.g. `turn:edge.atoll.chat:3478`). | [turn_credentials.pb.js](/database/pb_hooks/turn_credentials.pb.js) |
| `ATOLL_PUSH_WORKER_URL` | `[RUNTIME ONLY]` | `http://127.0.0.1:3000` | Endpoint of push-worker service. Automatically falls back to internal `http://127.0.0.1:3000`. | [captcha.pb.js](/database/pb_hooks/captcha.pb.js), [push_notifications.pb.js](/database/pb_hooks/push_notifications.pb.js) |
| `ATOLL_PUSH_WORKER_SECRET` | `[RUNTIME ONLY]` | None | Shared secret for webhook dispatches and subscription prunings. | [push_notifications.pb.js](/database/pb_hooks/push_notifications.pb.js), [push-worker/index.js](/push-worker/index.js) |
| `ATOLL_ALTCHA_SECRET` | `[RUNTIME ONLY]` | `'fallback-altcha...'` | Cryptographic secret key used to generate and verify ALTCHA challenges. | [captcha.pb.js](/database/pb_hooks/captcha.pb.js), [push-worker/index.js](/push-worker/index.js) |

##### S3 Storage Hook Variables (`[RUNTIME ONLY]`)

| Variable Name | Scope / Lifecycle | Default Value | Description | Used In / By |
|---------------|-------------------|---------------|-------------|--------------|
| `ATOLL_S3_ENDPOINT` | `[RUNTIME ONLY]` | None | Custom endpoint host for S3 API. | [s3_config.pb.js](/database/pb_hooks/s3_config.pb.js) |
| `ATOLL_S3_BUCKET` | `[RUNTIME ONLY]` | None | Name of the bucket used for storage. | [s3_config.pb.js](/database/pb_hooks/s3_config.pb.js) |
| `ATOLL_S3_ACCESS_KEY` | `[RUNTIME ONLY]` | None | S3 API Access Key ID. | [s3_config.pb.js](/database/pb_hooks/s3_config.pb.js) |
| `ATOLL_S3_SECRET_KEY` | `[RUNTIME ONLY]` | None | S3 API Secret Access Key. | [s3_config.pb.js](/database/pb_hooks/s3_config.pb.js) |
| `ATOLL_S3_REGION` | `[RUNTIME ONLY]` | `'us-east-1'` | S3 region location. | [s3_config.pb.js](/database/pb_hooks/s3_config.pb.js) |
| `ATOLL_S3_FORCE_PATH_STYLE` | `[RUNTIME ONLY]` | `false` | Enable or disable path-style addressing (`http://s3.endpoint/bucket`). | [s3_config.pb.js](/database/pb_hooks/s3_config.pb.js) |

##### SMTP Mail Server Hook Variables (`[RUNTIME ONLY]`)

| Variable Name | Scope / Lifecycle | Default Value | Description | Used In / By |
|---------------|-------------------|---------------|-------------|--------------|
| `ATOLL_SMTP_ENABLED` | `[RUNTIME ONLY]` | None | Enable or disable SMTP mail server. | [smtp_config.pb.js](/database/pb_hooks/smtp_config.pb.js) |
| `ATOLL_SMTP_HOST` | `[RUNTIME ONLY]` | None | Mail server host address. | [smtp_config.pb.js](/database/pb_hooks/smtp_config.pb.js) |
| `ATOLL_SMTP_PORT` | `[RUNTIME ONLY]` | `587` | Mail server port. | [smtp_config.pb.js](/database/pb_hooks/smtp_config.pb.js) |
| `ATOLL_SMTP_USERNAME` | `[RUNTIME ONLY]` | None | Username for mail server authentication. | [smtp_config.pb.js](/database/pb_hooks/smtp_config.pb.js) |
| `ATOLL_SMTP_PASSWORD` | `[RUNTIME ONLY]` | None | Password for mail server authentication. | [smtp_config.pb.js](/database/pb_hooks/smtp_config.pb.js) |
| `ATOLL_SMTP_TLS` | `[RUNTIME ONLY]` | `false` | Enforce TLS connection encryption (`true`/`false`). | [smtp_config.pb.js](/database/pb_hooks/smtp_config.pb.js) |
| `ATOLL_SMTP_AUTH_METHOD` | `[RUNTIME ONLY]` | `'PLAIN'` | The SMTP AUTH method (`PLAIN` or `LOGIN`). | [smtp_config.pb.js](/database/pb_hooks/smtp_config.pb.js) |
| `ATOLL_SMTP_LOCAL_NAME` | `[RUNTIME ONLY]` | None | Domain name or IP to use for HELO/EHLO exchange. | [smtp_config.pb.js](/database/pb_hooks/smtp_config.pb.js) |
| `ATOLL_SMTP_SENDER_NAME` | `[RUNTIME ONLY]` | `'Atoll Chat'` | Sender display name for transactional emails. | [smtp_config.pb.js](/database/pb_hooks/smtp_config.pb.js) |
| `ATOLL_SMTP_SENDER_ADDRESS` | `[RUNTIME ONLY]` | `'noreply@atoll.chat'` | Sender email address for transactional emails. | [smtp_config.pb.js](/database/pb_hooks/smtp_config.pb.js) |

---

#### 3. Push Worker Runtime Variables

| Variable Name | Scope / Lifecycle | Default Value | Description | Used In / By |
|---------------|-------------------|---------------|-------------|--------------|
| `PORT` | `[RUNTIME ONLY]` | `3000` | Port the push worker listens on. | [push-worker/index.js](/push-worker/index.js) |
| `ATOLL_PUSH_WORKER_SECRET` | `[RUNTIME ONLY]` | None | Secret to validate incoming prune notifications callbacks. | [push-worker/index.js](/push-worker/index.js) |
| `ATOLL_INTERNAL_POCKETBASE_URL` | `[RUNTIME ONLY]` | `http://127.0.0.1:8080` | URL of PocketBase server to dispatch subscription pruning requests. | [push-worker/index.js](/push-worker/index.js) |
| `ATOLL_VAPID_PUBLIC_KEY` | **`[BUILD & RUNTIME]`** | `BG6jbL6oHXUyR8...` | Public key matching client config to generate web-push auth headers. | [push-worker/index.js](/push-worker/index.js) |
| `ATOLL_VAPID_PRIVATE_KEY` | `[RUNTIME ONLY]` | None | VAPID private key used to sign web-push requests. | [push-worker/index.js](/push-worker/index.js) |
| `ATOLL_VAPID_SUBJECT` | `[RUNTIME ONLY]` | None | VAPID contact URL or mailto address (e.g. `mailto:admin@example.com`). | [push-worker/index.js](/push-worker/index.js) |
| `ATOLL_ALTCHA_SECRET` | `[RUNTIME ONLY]` | `'fallback-altcha...'` | HMAC secret key used by altcha-lib to generate/verify PoW challenges. | [push-worker/index.js](/push-worker/index.js) |

---

### 4. Development & Testing Variables

These environment variables configure local development provisioning and automated Playwright integration tests.

| Variable Name | Default Value | Description | Used In / By |
|---------------|---------------|-------------|--------------|
| `CI` | None | If defined, signals that the scripts are running inside a Continuous Integration pipeline. Sets E2E test retries to 2, configures headless test browser limits, and blocks launching background servers. | [playwright.config.js](/playwright.config.js) |
| `TURN_PORT` | `3478` | Specifies the local Coturn STUN/TURN server port dynamically mapped during local development environment boot. | [start-dev.js](/scripts/start-dev.js), [playwright.config.js](/playwright.config.js) |
| `PB_URL` | `http://127.0.0.1:8090` | Base URL configuration for automated provisioning and E2E mock server connections. | [provision-users.js](/scripts/provision-users.js), [base-test.js](/tests/e2e/fixtures/base-test.js) |
| `PB_ADMIN_EMAIL` | `admin@example.com` | Administrator email address used for auto-provisioning databases during local setup. | [provision-users.js](/scripts/provision-users.js) |
| `PB_ADMIN_PASSWORD` | `password123` | Administrator password configuration used for database auto-provisioning. | [provision-users.js](/scripts/provision-users.js) |

---

### 5. Coturn TURN/STUN Container & Health Check Configuration

The Coturn relay server (`atoll-coturn`) handles NAT traversal and WebRTC media relay when direct P2P connections cannot be established.

#### Container Health Check
Both `docker-compose.dev.yml` and `tests/e2e/setup/docker-compose.yml` include an automated health check using Coturn's native `turnutils_stunclient` tool. This performs real STUN binding handshakes against port `3478` rather than simple TCP socket checks:

```yaml
healthcheck:
  test: ["CMD-SHELL", "turnutils_stunclient -p 3478 127.0.0.1 || exit 1"]
  interval: 10s
  timeout: 5s
  retries: 3
  start_period: 5s
```

#### Production Security Recommendation
- **Development**: Uses long-term credentials (`--lt-cred-mech`, `--user=testuser:testpass`, `--realm=atoll-chat`).
- **Production**: Use Coturn's Shared Secret Authentication (`use-auth-secret` and `static-auth-secret=<secret_key>`). This enables backend services (PocketBase or Node API) to generate short-lived, time-limited HMAC-SHA1 credentials for users dynamically without exposing static credentials.
