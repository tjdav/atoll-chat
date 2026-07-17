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

Here is a template you can use for local development:

```env
# ==========================================
# Frontend Build-Time variables
# ==========================================
ATOLL_POCKETBASE_URL=http://localhost:8090

# LOCAL_ICE_SERVER=turn:127.0.0.1:3478
# ATOLL_NOTIFICATION_SOUND_DEBOUNCE_MS=1000

# Deeplinking variables (build-time)
ATOLL_IOS_TEAM_ID=TEAMID1234
ATOLL_IOS_APP_ID=com.atoll.chat
ATOLL_ANDROID_PACKAGE_NAME=com.atoll.chat
ATOLL_ANDROID_CERT_FINGERPRINT=FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C

# ==========================================
# PocketBase Runtime Variables
# ==========================================
PORT=8080
ATOLL_ALLOWED_ORIGINS=*
ATOLL_TURN_SHARED_SECRET=REPLACE_THIS_WITH_A_LONG_RANDOM_STRING
ATOLL_TURN_EXPIRES_IN_SECONDS=3600
ATOLL_PUSH_WORKER_URL=http://localhost:3000
ATOLL_PUSH_WORKER_SECRET=test_secret_123

# PocketBase S3 Config (Optional)
ATOLL_S3_ENDPOINT=
ATOLL_S3_BUCKET=
ATOLL_S3_ACCESS_KEY=
ATOLL_S3_SECRET_KEY=
ATOLL_S3_REGION=us-east-1
ATOLL_S3_FORCE_PATH_STYLE=false

# ==========================================
# Push Worker Runtime Variables
# ==========================================
ATOLL_VAPID_PUBLIC_KEY=BI42LscA_XvC28RpxgGk_g0-XW5yC4S_N924_68yL4Zpx8aX_P1_x2_58yL4Zpx8aX_P1_x2_58yL4Zpx8aX_P1_x2
ATOLL_VAPID_PRIVATE_KEY=your_private_key_here
ATOLL_VAPID_SUBJECT=mailto:admin@example.com
ATOLL_INTERNAL_POCKETBASE_URL=http://localhost:8080
```

---

## Environment Variable Categories

### 1. Build-Time variables (Frontend)

These variables configure the application compile-time behavior in [coralite.config.js](/coralite.config.js) and build plugins.

| Variable Name | Default Value | Description | Used In / By |
|---------------|---------------|-------------|--------------|
| `ATOLL_POCKETBASE_URL` | `http://localhost:8090` | Base URL of the PocketBase database server. In the [Dockerfile](/Dockerfile) build stage 1, this defaults to `/` for relative api routing. | [coralite.config.js](/coralite.config.js), [pocketbasePlugin](/src/plugins/pocketbase.js) |
| `ATOLL_VAPID_PUBLIC_KEY` | `BI42LscA_XvC28...` | VAPID public key for client push notifications subscription. | [coralite.config.js](/coralite.config.js), [pushPlugin](/src/plugins/push-plugin.js) |
| `LOCAL_ICE_SERVER` | None | Overrides the Ice Server configuration for local WebRTC calls. | [coralite.config.js](/coralite.config.js), [configPlugin](/src/plugins/config-plugin.js), [webrtcPlugin](/src/plugins/web-rtc-plugin.js) |
| `ATOLL_NOTIFICATION_SOUND_DEBOUNCE_MS` | `1000` | Minimum interval (in milliseconds) required between triggering message notification sounds. | [coralite.config.js](/coralite.config.js), [configPlugin](/src/plugins/config-plugin.js) |
| `ATOLL_IOS_TEAM_ID` | `TEAMID1234` | iOS Developer Team ID used to compile the `apple-app-site-association` file. | [deeplinkManifestPlugin](/src/plugins/deeplink-manifest-plugin.js) |
| `ATOLL_IOS_APP_ID` | `com.atoll.chat` | iOS App Bundle ID used to compile the `apple-app-site-association` file. | [deeplinkManifestPlugin](/src/plugins/deeplink-manifest-plugin.js) |
| `ATOLL_ANDROID_PACKAGE_NAME` | `com.atoll.chat` | Android app package name used to compile the `assetlinks.json` file. | [deeplinkManifestPlugin](/src/plugins/deeplink-manifest-plugin.js) |
| `ATOLL_ANDROID_CERT_FINGERPRINT` | `FA:C6:17:45:DC:09...` | SHA256 certificate fingerprint of the keystore signing the Android package, used to compile `assetlinks.json`. | [deeplinkManifestPlugin](/src/plugins/deeplink-manifest-plugin.js) |

---

### 2. Backend Runtime Variables (PocketBase)

These variables configure the runtime environment of the PocketBase application and its JavaScript hooks (located in [database/pb_hooks/](/database/pb_hooks/)).

| Variable Name | Default Value | Description | Used In / By |
|---------------|---------------|-------------|--------------|
| `PORT` | `8080` (or `8090` in dev) | The port number that the PocketBase server listens on. | [Dockerfile](/Dockerfile) |
| `ATOLL_ALLOWED_ORIGINS` | `*` | CORS origins configuration allowed by PocketBase. | [Dockerfile](/Dockerfile) |
| `ATOLL_TURN_SHARED_SECRET` | `'REPLACE_THIS_WITH_A_LONG_RANDOM_STRING'` | Shared cryptographic key for signing dynamic WebRTC TURN relay credentials. | [turn_credentials.pb.js](/database/pb_hooks/turn_credentials.pb.js) |
| `ATOLL_TURN_EXPIRES_IN_SECONDS` | `3600` | Expiry duration (TTL) for generated TURN credentials. | [turn_credentials.pb.js](/database/pb_hooks/turn_credentials.pb.js) |
| `ATOLL_TURN_URIS` | None | Comma-separated list of STUN/TURN URIs passed to the client (e.g., `turn:edge.atoll.chat:3478`). | [turn_credentials.pb.js](/database/pb_hooks/turn_credentials.pb.js) |
| `ATOLL_PUSH_WORKER_URL` | None | URL endpoint of the standalone push worker microservice. | [push_notifications.pb.js](/database/pb_hooks/push_notifications.pb.js), [docker-compose.yml](/docker-compose.yml) |
| `ATOLL_PUSH_WORKER_SECRET` | None | Cryptographic secret shared with the push-worker, used to authenticate webhook dispatches and subscription prunings. | [push_notifications.pb.js](/database/pb_hooks/push_notifications.pb.js), [docker-compose.yml](/docker-compose.yml) |

#### S3 Storage Hook Variables
If the following variables are present, they automatically enable and configure S3 compatibility storage in PocketBase for uploaded media/assets:

| Variable Name | Default Value | Description | Used In / By |
|---------------|---------------|-------------|--------------|
| `ATOLL_S3_ENDPOINT` | None | Custom endpoint host for the S3 compatibility API. | [s3_config.pb.js](/database/pb_hooks/s3_config.pb.js) |
| `ATOLL_S3_BUCKET` | None | Name of the bucket used for storage. | [s3_config.pb.js](/database/pb_hooks/s3_config.pb.js) |
| `ATOLL_S3_ACCESS_KEY` | None | S3 API Access Key ID. | [s3_config.pb.js](/database/pb_hooks/s3_config.pb.js) |
| `ATOLL_S3_SECRET_KEY` | None | S3 API Secret Access Key. | [s3_config.pb.js](/database/pb_hooks/s3_config.pb.js) |
| `ATOLL_S3_REGION` | `'us-east-1'` | S3 region location. | [s3_config.pb.js](/database/pb_hooks/s3_config.pb.js) |
| `ATOLL_S3_FORCE_PATH_STYLE` | `false` | Enable or disable path-style addressing (`http://s3.endpoint/bucket`) instead of virtual-host addressing (`http://bucket.s3.endpoint`). Set to `'true'` to enable. | [s3_config.pb.js](/database/pb_hooks/s3_config.pb.js) |

---

### 3. Push Worker Runtime Variables

These variables configure the Node.js service responsible for dispatching push notifications.

| Variable Name | Default Value | Description | Used In / By |
|---------------|---------------|-------------|--------------|
| `PORT` | `3000` | Port the push worker listens on. | [push-worker/index.js](/push-worker/index.js) |
| `ATOLL_PUSH_WORKER_SECRET` | None | Security secret shared with the backend, used to validate incoming prune notifications callback and auth headers. | [push-worker/index.js](/push-worker/index.js) |
| `ATOLL_INTERNAL_POCKETBASE_URL` | None | URL of the PocketBase application server, used to dispatch subscription pruning requests back to PocketBase. | [push-worker/index.js](/push-worker/index.js) |
| `ATOLL_VAPID_PUBLIC_KEY` | None | VAPID public key matching the client configuration, used to generate web-push authorization headers. | [push-worker/index.js](/push-worker/index.js) |
| `ATOLL_VAPID_PRIVATE_KEY` | None | VAPID private key used to sign web-push requests. | [push-worker/index.js](/push-worker/index.js) |
| `ATOLL_VAPID_SUBJECT` | None | VAPID contact URL or mailto address (e.g., `mailto:admin@example.com`). | [push-worker/index.js](/push-worker/index.js) |

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
