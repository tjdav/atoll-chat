# Atoll Echo Bot Example

This directory contains a complete, runnable example bot demonstrating `@atoll/bot` SDK features.

## Features

- **Settings:** Customizable greeting message and secret token (`defineSettings`).
- **Commands:** `/ping` (returns a local message response) and `/roll` (posts die rolls to the room) (`defineCommand`).
- **Triggers:** Webhook endpoint at `/hooks/example` and hourly cron schedule (`defineTrigger`).
- **Handlers:** `install`, `uninstall`, `message`, `grantUpdated`, `webhook`, and `schedule`.
- **Stores:** Demonstrates `ctx.settings`, `ctx.storage`, and `ctx.rooms`.

## Usage

### Install Dependencies

From the repository root or example directory:

```bash
pnpm install
```

*Note: In this repository workspace, `@atoll/bot` is linked directly via `workspace:*`. If copying this example to an external project, change `"@atoll/bot": "workspace:*"` in `package.json` to `"@atoll/bot": "^1.0.0"`.*

### Run

Run the bot against an Atoll server:

```bash
pnpm start
```

### Development Mode

Run with hot reload and a local mock server:

```bash
pnpm dev
```

### Test

Run unit tests for the example bot:

```bash
pnpm test
```

## Documentation

For full SDK documentation and API references, see [`packages/bot/README.md`](../../packages/bot/README.md).
