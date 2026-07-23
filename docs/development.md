# Local Development Guide

This document describes how to set up and run the local development environment for the Atoll Chat application. The development lifecycle is managed primarily through the standard `pnpm run start` orchestration script.

---

## Getting Started

To spin up the entire development environment, run the following command in the project root:

```bash
pnpm run start
```

This single command orchestrates the backend database (PocketBase), a WebRTC TURN/STUN relay server (Coturn), automatic database migration, user provisioning, and the frontend web server.

---

## How it Works (`scripts/start-dev.js`)

When you run `pnpm run start`, it invokes the dev setup orchestrator defined in [scripts/start-dev.js](/scripts/start-dev.js). Here is the sequential order of actions taken by this script:

### 1. Dev Services Setup (Docker vs. Local Fallback)
The script first attempts to spin up backend services using Docker Compose:
- **Docker Compose:** Runs `docker compose -f docker-compose.dev.yml up -d --build` to start PocketBase and Coturn in the background. See [docker-compose.dev.yml](/docker-compose.dev.yml) for service definitions.
- **Local Fallback:** If Docker is not installed or the daemon is not running, the script automatically falls back to downloading a local PocketBase binary:
  - Resolves the OS platform and architecture.
  - Downloads the corresponding PocketBase zip release (v0.39.8) from GitHub into the [bin/](/bin) folder.
  - Extracts the binary and runs it locally on port `8090` using the local database folders.

### 2. Health Monitoring & Superuser Setup
The script polls the PocketBase health endpoint (`http://127.0.0.1:8090/api/health`) for up to 30 seconds.
- Once PocketBase is healthy, it ensures that a default superuser admin account exists:
  - **Admin Email:** `admin@example.com`
  - **Admin Password:** `password123`

### 3. Test User Provisioning
The orchestrator runs [scripts/provision-users.js](/scripts/provision-users.js) to set up mock accounts for testing:
- Generates cryptographic identity and encryption keys via `libsodium-wrappers-sumo`.
- Derives a vault Key Encryption Key (KEK) using Argon2id.
- Provisions three standard test users (Alice, Bob, Charlie) with pre-configured cryptographic vaults.

### 4. Frontend Application Start
Finally, the script starts the Coralite dev server by executing:
```bash
pnpm run start:app
```
It forwards the `LOCAL_ICE_SERVER` environment variable pointing to the local Coturn TURN server (`turn:127.0.0.1:3478`).

### 5. Graceful Teardown
On receiving exit signals (like `Ctrl+C`), the orchestrator captures the interrupt and cleans up:
- Stops the frontend application.
- If Docker Compose was used, executes `docker compose -f docker-compose.dev.yml down`.
- If the local fallback was used, kills the spawned PocketBase process.

---

## Available Services

Once the development environment is running, the following services are available locally:

| Service | Address / Port | Credentials / Purpose | Details |
|---|---|---|---|
| **Frontend Web App** | `http://localhost:8080` (or dynamic Coralite port) | Main Chat client UI | Built & served via [coralite.config.js](/coralite.config.js) |
| **PocketBase API** | `http://127.0.0.1:8090` | API requests and migrations | Local DB data is saved in [pb_data/](/pb_data) |
| **PocketBase Admin Dashboard** | `http://127.0.0.1:8090/_/` | Email: `admin@example.com`<br>Password: `password123` | Back-office to inspect tables, collections, logs, and settings. |
| **Coturn TURN/STUN Relay** | `turn:127.0.0.1:3478` | Username: `testuser`<br>Password: `testpass` | Handles WebRTC relaying when direct peer connections fail. |

---

## Provisioned Test Accounts

The following mock users are automatically provisioned and ready for local development testing:

| Username | Email | Password | Vault Password |
|---|---|---|---|
| **Alice** | `alice@example.com` | `Password123!` | `VaultPassword123!` |
| **Bob** | `bob@example.com` | `Password123!` | `VaultPassword123!` |
| **Charlie** | `charlie@example.com` | `Password123!` | `VaultPassword123!` |

---

## Available Scripts

The following helper scripts are configured in [package.json](/package.json):

### Development Scripts

- **`pnpm run start`**
  Runs the full dev setup orchestrator ([scripts/start-dev.js](/scripts/start-dev.js)).
- **`pnpm run start:app`**
  Directly runs the Coralite development compiler server using `coralite-scripts dev`.
- **`pnpm run build`**
  Compiles the production-ready static assets to the `dist/` directory using `coralite-scripts build`.

### Testing Scripts

- **`pnpm run test:server`**
  Runs the testing suite in dev mode using `coralite-scripts test`.
- **`pnpm run test:unit`**
  Runs backend/unit tests with the native Node.js test runner and experimental VM module support.
- **`pnpm run test:unit:coverage`**
  Runs unit tests and outputs code coverage reports.
- **`pnpm run test:e2e`**
  Generates a synthetic audio/video test input asset and executes Playwright end-to-end integration tests.
- **`pnpm run test:e2e:ui`**
  Runs the end-to-end integration tests with the visual Playwright UI runner.

### Code Quality Scripts

- **`pnpm run lint:types`**
  Checks TypeScript types throughout the codebase without emitting output files (`tsc --noEmit`).
- **`pnpm run lint:format`**
  Runs ESLint to inspect code conventions, style guide checks, and applies automatic fixes.
