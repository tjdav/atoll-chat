# @atoll/bot

`@atoll/bot` is the official Node.js SDK for authoring and running bots on the Atoll communication platform.

## What it is

Atoll is an end-to-end encrypted messaging network. `@atoll/bot` provides a structured runtime, cryptographic helpers, state management, and developer tools for building bots that communicate securely within Atoll rooms.

Bots built with `@atoll/bot` operate in either member mode or observer mode, responding to commands, message events, webhooks, and cron schedules. The SDK handles encryption, signature verification, keystore management, reconnection backoff, and state persistence out of the box so you can focus on bot logic.

For complete architectural and API details, refer to the authoritative [Atoll Bot SDK Specification](https://raw.githubusercontent.com/tjdav/playground/refs/heads/bench-workspace-relay-11510657464757500912/atoll-bot-v1.md).

## Install

```bash
pnpm add @atoll/bot
```

*Note: Requires Node.js >= 22.22.2.*

## Quick start

Here is a minimal, complete bot file (`bot.js`) that replies to incoming messages:

```js
import { defineBot } from '@atoll/bot'

export default defineBot({
  id: 'com.example.echo',
  label: 'Echo Bot',
  version: '1.0.0',
  mode: 'observer',
  capabilities: ['post_message'],
  hostApi: '1.0',

  handlers: {
    async message(ctx) {
      if (!ctx.event.plaintext) return
      await ctx.reply({ text: `Echo: ${ctx.event.plaintext}` })
    }
  }
})
```

To run this bot using the CLI:

```bash
npx atoll-bot run ./bot.js
```

## Authoring surface

The SDK exposes declarative builders to define settings, commands, triggers, and full bot configurations.

### defineBot

`defineBot` validates and returns the complete bot configuration object.

```js
import { defineBot } from '@atoll/bot'

export default defineBot({
  id: 'com.example.mybot',
  label: 'My Bot',
  version: '1.0.0',
  mode: 'observer',
  capabilities: ['post_message'],
  hostApi: '1.0',
  handlers: {
    async install(ctx) {
      ctx.log.info('Bot installed')
    }
  }
})
```

### defineSettings

`defineSettings` defines configurable settings for your bot. Setting values are encrypted and managed securely.

```js
import { defineBot, defineSettings } from '@atoll/bot'

const settings = defineSettings({
  apiKey: {
    type: 'string',
    label: 'API Key',
    description: 'Secret token for external API access',
    secret: true
  }
})

export default defineBot({
  id: 'com.example.api-bot',
  label: 'API Bot',
  version: '1.0.0',
  mode: 'observer',
  capabilities: ['post_message'],
  hostApi: '1.0',
  settings,
  handlers: {
    async message(ctx) {
      // Secret values are automatically decrypted when accessed via ctx.settings
      const token = await ctx.settings.get('apiKey')
      ctx.log.info({ hasToken: Boolean(token) }, 'Accessing external service')
    }
  }
})
```

### defineCommand

`defineCommand` defines slash commands that users can invoke from chat clients. Command results can return local messages, room posts, toasts, or panels.

```js
import { defineBot, defineCommand, defineCommands } from '@atoll/bot'

const rollCommand = defineCommand({
  name: 'roll',
  description: 'Roll a random number',
  args: [
    { name: 'max', type: 'number', description: 'Maximum roll', required: false }
  ],
  async handler(ctx) {
    const max = ctx.args.max ?? 100
    const roll = Math.floor(Math.random() * max) + 1
    return {
      type: 'local_message',
      message: `You rolled a ${roll} (1-${max})`
    }
  }
})

export default defineBot({
  id: 'com.example.dice',
  label: 'Dice Bot',
  version: '1.0.0',
  mode: 'observer',
  capabilities: ['post_message'],
  hostApi: '1.0',
  commands: defineCommands([rollCommand])
})
```

### defineTrigger

`defineTrigger` declares HTTP webhook endpoints or cron schedule triggers.

```js
import { defineBot, defineTrigger } from '@atoll/bot'

const githubWebhook = defineTrigger({
  type: 'webhook',
  name: 'github',
  path: '/github-events',
  method: 'POST',
  secret: 'GITHUB_WEBHOOK_SECRET'
})

const hourlySchedule = defineTrigger({
  type: 'schedule',
  name: 'hourly-summary',
  expression: '0 * * * *',
  timezone: 'UTC'
})

export default defineBot({
  id: 'com.example.notifications',
  label: 'Notification Bot',
  version: '1.0.0',
  mode: 'observer',
  capabilities: ['post_message'],
  hostApi: '1.0',
  triggers: [githubWebhook, hourlySchedule],
  handlers: {
    async webhook(ctx) {
      ctx.log.info({ path: ctx.event.path }, 'Received webhook')
    },
    async schedule(ctx) {
      ctx.log.info('Running hourly scheduled job')
    }
  }
})
```

### Handlers

Bots register lifecycle and event handlers under the `handlers` object:

- `install(ctx)` — Invoked when the bot is installed.
- `uninstall(ctx)` — Invoked when the bot is uninstalled or shut down.
- `message(ctx)` — Invoked when a message is posted to a room the bot is granted into.
- `room(ctx)` — Invoked on room events (e.g. member additions, updates).
- `grantUpdated(ctx)` — Invoked when room access grants change.
- `webhook(ctx)` — Invoked when a declared webhook endpoint receives a request.
- `schedule(ctx)` — Invoked when a declared cron schedule triggers.

### The BotCtx

Every handler receives a `BotCtx` context object containing runtime state, utilities, and stores:

- `ctx.bot` — Bot metadata (`id`, `label`, `ownerUserId`).
- `ctx.grant` — Current room grant details (`roomId`, `mode`, `scopes`).
- `ctx.event` — Event details (message payload, webhook request, or schedule event).
- `ctx.args` — Validated arguments for command handlers.
- `ctx.log` — Structured redacting logger (`ctx.log.info`, `ctx.log.warn`, `ctx.log.error`).

#### Response methods

- `await ctx.post({ text, roomId? })` — Encrypts and posts a message to a room.
- `await ctx.reply({ text })` — Posts a message in reply to the current message event.
- `await ctx.sendLocal({ text })` — Sends an encrypted local message to the bot owner.
- `await ctx.fetch(url, opts)` — Secure outbound HTTP fetch helper with stripped query logging.
- `await ctx.fetchUserUrl(url, opts)` — Outbound HTTP fetch on behalf of a user.

#### Stores

- `ctx.settings` — Encrypted settings store (`await ctx.settings.get(key, opts)`).
- `ctx.storage` — Encrypted persistent key-value store (`await ctx.storage.get(key)`, `set`, `delete`, `clear`).
- `ctx.rooms` — Room list store (`await ctx.rooms.list()`, `get(roomId)`).

### Errors

The SDK provides code-bearing error classes inheriting from `BotError`:

- `ValidationError` (`validation_error`) — Invalid configuration or arguments.
- `KeystoreLockedError` (`keystore_locked`) — Keystore passphrase missing or incorrect.
- `PostFailedError` (`post_failed`) — Failed to post message.
- `SendLocalFailedError` (`send_local_failed`) — Failed to send local message.
- `SettingsWriteFailedError` (`settings_write_failed`) — Attempted read-only settings write.
- `HttpRequestError` (`http_request_failed`) — Outbound HTTP request failure.
- `PausedError` (`bot_paused`) — Bot execution paused due to handler failure threshold.

## Testing

Use `@atoll/bot/testing` to test command handlers and bot logic in isolation without running a server.

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestCtx } from '@atoll/bot/testing'

test('roll command generates roll message', async () => {
  const ctx = createTestCtx({
    args: { max: 20 }
  })

  const roll = Math.floor(Math.random() * 20) + 1
  assert.ok(roll >= 1 && roll <= 20)
  assert.equal(ctx.calls.post.length, 0)
})
```

To test full lifecycle integration, use `createTestRuntime`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestRuntime } from '@atoll/bot/testing'
import myBot from './bot.js'

test('e2e bot message handling', async () => {
  const runtime = await createTestRuntime({ bot: myBot })
  const res = await runtime.inject({
    type: 'message',
    roomId: 'r_test',
    plaintext: 'hello'
  })
  assert.equal(res.ok, true)
  await runtime.close()
})
```

## CLI

The `atoll-bot` CLI manages bot registration, execution, developer tools, and keystores.

| Command | Usage | Purpose |
|---|---|---|
| `validate` | `atoll-bot validate <path>` | Validate a bot source file configuration |
| `register` | `atoll-bot register <path>` | Register a bot with the Atoll server and generate keystore |
| `login` | `atoll-bot login` | Update cached operator session token |
| `logout` | `atoll-bot logout` | Clear cached operator session token |
| `run` | `atoll-bot run <path>` | Run a bot process in production mode |
| `dev` | `atoll-bot dev <path>` | Run bot in local development mode with hot reload |
| `inspect` | `atoll-bot inspect [room-id]` | Inspect current bot state snapshot |
| `tail` | `atoll-bot tail [--from-start]` | Stream live diagnostic logs |
| `export-keys` | `atoll-bot export-keys [--out <path>]` | Export encrypted keystore blob |
| `import-keys` | `atoll-bot import-keys <path>` | Import encrypted keystore blob |
| `sandbox` | `atoll-bot sandbox <connect\|run\|reset>` | Manage sandbox testing environment |

## Environment variables

The SDK runtime resolves configuration from environment variables with precedence over `bot.toml`:

| Variable | Required | Purpose |
|---|---|---|
| `ATOL_SERVER_URL` | Yes | Base URL of the Atoll server |
| `ATOL_BOT_KEYSTORE` | No | Path to the encrypted bot keystore file (default: `./bot.keystore`) |
| `ATOL_BOT_KEYSTORE_SECRET` | No | Passphrase for decrypting the keystore |
| `ATOL_USER_TOKEN` | For `register`/`login` | User session token for registration and login commands |
| `ATOL_BOT_CONFIG` | No | Path to `bot.toml` configuration file |
| `ATOL_LOG_LEVEL` | No | Logging level (`debug`, `info`, `warn`, `error`) |
| `ATOL_LOG_FORMAT` | No | Log output format (`json` or `pretty`) |

## The server contract

`@atoll/bot` implements the client-side bot protocol defined in the Atoll Server Specification. The SDK enforces `hostApi: '1.0'` matching `HOST_API_VERSION`. A version mismatch at startup aborts execution to ensure protocol compatibility. For full specification details, refer to the [Atoll Bot Specification](https://raw.githubusercontent.com/tjdav/playground/refs/heads/bench-workspace-relay-11510657464757500912/atoll-bot-v1.md).

## Status

Implements Atoll Bot Specification v1.0.0.

## License

AGPL-3.0
