# Recipe Author Guide

This guide is for anyone who wants to add a recipe to the recipe library in `@atoll/recipes`. It assumes you know JavaScript, have a high-level understanding of the bot SDK and primitives, and want to create a new recipe. It assumes no knowledge of the engine's internals.

## What a recipe is

A recipe is a declaration, not executable code. It names a kind of bot, declares its build-time slots and runtime settings, and composes primitive instances to define its behaviour. When a user submits a natural-language request, the engine matches the request to a recipe, composes the recipe with the user's slot values, and emits a standard `bot.js` file. As a recipe author, you write JSON declarations and markdown documentation; you never write JavaScript source code for the bot.

## The recipe directory

Each recipe in the library lives in its own directory under `packages/recipes/recipes/<recipe-id>/`. A recipe directory contains the following files:

- `recipe.json` — **Required**. The source of truth for the recipe definition. Contains all metadata, capability requirements, slot definitions, setting declarations, handlers, commands, triggers, and constraints.
- `recipe.md` — **Required**. Human-readable documentation for the recipe. Explains what the recipe does, how to configure its slots and settings, and any constraints or usage requirements.
- `tests/` — **Optional**. Optional directory for recipe-specific test fixtures or extra assets if required by local tools. Standard recipe unit test suites live alongside other recipe tests in `packages/recipes/tests/unit/recipes/<recipe-id>.spec.js`.

The `recipe.json` file is parsed and validated by the compiler at build time. The `recipe.md` file is served to operators and client applications to explain the recipe's purpose and usage.

## The recipe.json format

The table below describes every field in a `recipe.json` structure. The authoritative shape is defined by the `Recipe` typedef in [`src/types.js`](../src/types.js).

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | Yes | Stable identifier in kebab-case (for example, `echo-command`). Must match the directory name. |
| `version` | `string` | Yes | Semver version string (for example, `1.0.0`). |
| `label` | `string` | Yes | Short, human-readable display title (for example, `Echo`). |
| `description` | `string` | Yes | One-sentence description of what the recipe builds. |
| `kind` | `string` | Yes | Runtime category: `'pure'`, `'assisted'`, or `'operated'`. |
| `targets` | `string[]` | No | Target artifact types. Defaults to `["bot"]`. |
| `capabilities` | `string[]` | Yes | Capability ceiling required by the recipe (for example, `["read_commands", "post_message"]`). Must be a superset of all composed primitive capabilities. |
| `slots` | `object[]` | Yes | Build-time parameters requested from the user during installation. |
| `settings` | `object` | No | Runtime settings declared on the recipe for post-install operator configuration. |
| `handlers` | `object` | Yes | Map of SDK event handlers (`install`, `message`, etc.) composed from primitive instances. |
| `commands` | `object` | No | Map of slash commands exposed by the recipe, keyed by command name. |
| `triggers` | `object[]` | No | Array of background triggers (`schedule-task`, `webhook-receive`). |
| `constraints` | `string[]` | No | Human-readable list of limitations or operational constraints. |

Here is the complete `recipe.json` from the `echo-command` recipe as a running example:

```json
{
  "id": "echo-command",
  "version": "1.0.0",
  "label": "Echo",
  "description": "Repeats whatever text is passed to the /echo command.",
  "kind": "pure",
  "capabilities": ["read_commands", "post_message"],
  "slots": [],
  "handlers": {
    "install": {
      "id": "install-hook",
      "primitive": "post-response",
      "config": { "text": "Echo is ready. Use /echo to repeat a message." }
    }
  },
  "commands": {
    "echo": {
      "id": "echo-cmd",
      "primitive": "expose-command",
      "config": {
        "name": "echo",
        "description": "Repeat a message in the room.",
        "args": {
          "text": { "type": "string", "required": true }
        }
      },
      "children": [
        {
          "id": "echo-post",
          "primitive": "post-response",
          "config": { "text": "{{args.text}}" }
        }
      ]
    }
  },
  "constraints": [
    "The bot posts publicly in the room. It has no private output mode.",
    "The bot does not attribute the echoed text to the invoker.",
    "The /echo command takes no optional arguments and has no default text."
  ]
}
```

## Slots and settings

Recipes support two mechanisms for parameterization: build-time **slots** and runtime **settings**.

- **Slots** are filled in once during the build flow when the user instantiates the recipe. Slot values are substituted into the primitive configuration at **compose time** and baked directly into the emitted `bot.js`.
  - In `echo-command`, `slots` is an empty array `[]` because no build-time customization is needed.
  - In `keyword-alert`, the `keyword` slot specifies the word or phrase to watch for at build time:
    ```json
    {
      "slots": [
        {
          "name": "keyword",
          "type": "string",
          "question": "What keyword should trigger an alert?",
          "default": "urgent",
          "hint": "The bot watches for messages containing this word."
        }
      ]
    }
    ```

- **Settings** are declared on the recipe and read at runtime by the `settings-read` primitive. An operator or user can update setting values after installation without rebuilding or re-deploying the bot.
  - In `sticky`, the `message` setting allows operators to change the sticky message text on demand:
    ```json
    {
      "settings": {
        "message": {
          "type": "string",
          "label": "Sticky Message",
          "description": "The message posted when /say is invoked.",
          "default": "Sticky is ready."
        }
      }
    }
    ```
  - Settings support scoping via the `scope` configuration property on `settings-read` and `settings-write` primitives (`scope: 'user'` or `scope: 'room'`).
    - `scope: 'user'` stores and reads per-user setting values across the bot.
    - `scope: 'room'` isolates setting values per room context.

## Substitution

Recipes use two distinct substitution syntaxes depending on when the value is resolved.

- `{slotName}` — **Single-brace token**. Substituted at **compose time** by the compiler using the slot values supplied during instantiation. Appears in primitive `config` values in `recipe.json`.
- `{{path}}` — **Double-brace token**. Substituted at **dispatch time** by the primitive handler using the runtime input passed to the handler. Appears in primitive `config` string templates resolved when events or commands run.
- `{{.}}` — **Whole-input token**. A special dispatch-time double-brace template referring to the entire input payload passed into the primitive handler.

The two syntaxes are completely independent and can be used in different parts of the same recipe.

For example:
- In `keyword-alert`, `{keyword}` is resolved at compose time from the slot value to configure the `watch-pattern` primitive:
  ```json
  {
    "config": {
      "pattern": "{keyword}",
      "flags": "i"
    }
  }
  ```
- In `daily-reminder`, `{{.}}` is resolved at dispatch time from the runtime settings input to format the output string in `post-response`:
  ```json
  {
    "config": {
      "text": "{{.}}"
    }
  }
  ```

## The primitive catalog

All fourteen primitives currently registered for the `bot` target in `packages/recipes/src/primitives/index.js` are listed below in alphabetical order by ID.

### `expose-command`

Exposes a slash command to the room. Wraps child handlers and passes parsed command arguments.

- **Capabilities**: `["read_commands"]`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "name": { "type": "string", "minLength": 1, "pattern": "^[a-z][a-z0-9-]*$" },
      "description": { "type": "string" },
      "args": { "type": "object" }
    },
    "required": ["name"],
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "echo-cmd",
    "primitive": "expose-command",
    "config": {
      "name": "echo",
      "description": "Repeat a message",
      "args": { "text": { "type": "string", "required": true } }
    },
    "children": [
      {
        "id": "echo-post",
        "primitive": "post-response",
        "config": { "text": "{{args.text}}" }
      }
    ]
  }
  ```

### `http-fetch`

Performs an HTTP fetch request against a remote endpoint.

- **Capabilities**: `none`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "url": { "type": "string", "minLength": 1 },
      "method": { "type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"], "default": "GET" },
      "headers": { "type": "object" },
      "body": {},
      "responseMode": { "type": "string", "enum": ["json", "text", "status"], "default": "json" }
    },
    "required": ["url"],
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "fetch-quote",
    "primitive": "http-fetch",
    "config": {
      "url": "https://api.quotable.io/random",
      "method": "GET",
      "responseMode": "json"
    }
  }
  ```

### `keyed-store`

Reads from or writes to the bot's persistent key-value storage.

- **Capabilities**: `none`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "mode": { "type": "string", "enum": ["set", "get"], "default": "set" },
      "key": { "type": "string", "minLength": 1 },
      "value": {},
      "default": {}
    },
    "required": ["key"],
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "save-note",
    "primitive": "keyed-store",
    "config": {
      "mode": "set",
      "key": "notes:{{args.name}}",
      "value": { "name": "{{args.name}}", "value": "{{args.value}}" }
    }
  }
  ```

### `llm-complete`

Generates text or structured JSON completions via a language model endpoint.

- **Capabilities**: `none`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "mode": { "type": "string", "enum": ["saas", "local"], "default": "saas" },
      "baseUrl": { "type": "string", "minLength": 1 },
      "model": { "type": "string", "minLength": 1 },
      "systemPrompt": { "type": "string" },
      "userPrompt": { "type": "string", "minLength": 1 },
      "responseFormat": { "type": "string", "enum": ["text", "json"], "default": "text" },
      "temperature": { "type": "number", "minimum": 0, "maximum": 2, "default": 0.1 }
    },
    "required": ["baseUrl", "model", "userPrompt"],
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "summarize",
    "primitive": "llm-complete",
    "config": {
      "baseUrl": "{llmBaseUrl}",
      "model": "gpt-4o-mini",
      "userPrompt": "Summarize this: {{text}}"
    }
  }
  ```

### `post-response`

Posts a public message into a room.

- **Capabilities**: `["post_message"]`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "text": { "type": "string", "minLength": 1 },
      "roomId": { "type": "string", "minLength": 1 }
    },
    "required": ["text"],
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "post-msg",
    "primitive": "post-response",
    "config": {
      "text": "Keyword detected: {keyword}"
    }
  }
  ```

### `queue-for-operator`

Enqueues a request for human operator review and approval.

- **Capabilities**: `none`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "audience": { "type": "string", "enum": ["private", "public"], "default": "private" },
      "timeout": { "type": "string", "default": "never" },
      "onTimeout": { "type": "string", "enum": ["ignore", "canned"], "default": "ignore" },
      "cannedResponse": { "type": "string" },
      "requestId": { "type": "string" }
    },
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "enqueue",
    "primitive": "queue-for-operator",
    "config": {
      "audience": "private",
      "timeout": "300"
    }
  }
  ```

### `reply-local`

Returns an ephemeral local message directly to the command invoker's client device.

- **Capabilities**: `none`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "text": { "type": "string", "minLength": 1 }
    },
    "required": ["text"],
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "reply-saved",
    "primitive": "reply-local",
    "config": {
      "text": "Saved note '{{args.name}}'."
    }
  }
  ```

### `schedule-task`

Schedules a recurring background job according to a cron pattern.

- **Capabilities**: `none`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "name": { "type": "string", "minLength": 1, "pattern": "^[a-z][a-z0-9-]*$" },
      "cron": { "type": "string", "minLength": 1 },
      "timezone": { "type": "string" }
    },
    "required": ["name", "cron"],
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "daily-trigger",
    "primitive": "schedule-task",
    "config": {
      "name": "daily-checkin",
      "cron": "{cron}",
      "timezone": "{timezone}"
    }
  }
  ```

### `send-local`

Sends a local notification or message to the bot owner or local client interface.

- **Capabilities**: `none`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "text": { "type": "string", "minLength": 1 },
      "format": { "type": "string", "enum": ["text", "markdown"] }
    },
    "required": ["text"],
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "notify-owner",
    "primitive": "send-local",
    "config": {
      "text": "Webhook received: {{message}}",
      "format": "text"
    }
  }
  ```

### `settings-read`

Reads a configured setting value from runtime setting storage.

- **Capabilities**: `none`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "key": { "type": "string", "minLength": 1 },
      "room": { "type": "string", "minLength": 1 },
      "scope": { "type": "string", "enum": ["user", "room"] }
    },
    "required": ["key"],
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "read-msg-setting",
    "primitive": "settings-read",
    "config": {
      "key": "message",
      "scope": "user"
    }
  }
  ```

### `settings-write`

Writes a setting value to runtime setting storage.

- **Capabilities**: `none`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "key": { "type": "string", "minLength": 1 },
      "room": { "type": "string", "minLength": 1 },
      "scope": { "type": "string", "enum": ["user", "room"] },
      "value": {}
    },
    "required": ["key"],
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "write-topic",
    "primitive": "settings-write",
    "config": {
      "key": "topic",
      "scope": "room",
      "value": "{{args.text}}"
    }
  }
  ```

### `transform`

Transforms input data via JSON parsing, serialization, or property path extraction.

- **Capabilities**: `none`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "op": { "type": "string", "enum": ["json", "stringify", "pick"] },
      "path": { "type": "string", "minLength": 1 }
    },
    "required": ["op"],
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "extract-body",
    "primitive": "transform",
    "config": {
      "op": "pick",
      "path": "body"
    }
  }
  ```

### `watch-pattern`

Evaluates incoming room message content against a regular expression pattern.

- **Capabilities**: `["read_content"]`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "pattern": { "type": "string", "minLength": 1 },
      "flags": { "type": "string" },
      "enabled": { "type": "boolean", "default": true }
    },
    "required": ["pattern"],
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "watch-urgent",
    "primitive": "watch-pattern",
    "config": {
      "pattern": "{keyword}",
      "flags": "i"
    }
  }
  ```

### `webhook-receive`

Receives inbound HTTP webhooks at a designated path.

- **Capabilities**: `none`
- **Config Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "path": { "type": "string", "minLength": 1 },
      "method": { "type": "string", "enum": ["POST", "PUT", "PATCH"], "default": "POST" },
      "secret": { "type": "string" },
      "idempotency": { "type": "string" },
      "retries": { "type": "number", "minimum": 0 },
      "retryDelayMs": { "type": "number", "minimum": 0 }
    },
    "required": ["path"],
    "additionalProperties": false
  }
  ```
- **Example**:
  ```json
  {
    "id": "recv-hook",
    "primitive": "webhook-receive",
    "config": {
      "path": "{path}",
      "method": "POST"
    }
  }
  ```

## Handlers, commands, and triggers

Composition in a recipe occurs across three distinct surfaces in `recipe.json`:

1. **`handlers`** — An object keyed by SDK event handler name (`install`, `uninstall`, `grantUpdated`, `message`, `room`, `webhook`, `schedule`). Each handler maps to a top-level primitive instance executed when that event fires.
   ```json
   {
     "handlers": {
       "message": {
         "id": "on-message",
         "primitive": "watch-pattern",
         "config": { "pattern": "{keyword}", "flags": "i" },
         "children": [
           {
             "id": "alert-post",
             "primitive": "post-response",
             "config": { "text": "Keyword detected: {keyword}" }
           }
         ]
       }
     }
   }
   ```
2. **`commands`** — An object keyed by slash command name. Each entry must be an `expose-command` primitive instance defining command metadata and arguments.
   ```json
   {
     "commands": {
       "echo": {
         "id": "echo-cmd",
         "primitive": "expose-command",
         "config": {
           "name": "echo",
           "description": "Repeat a message in the room.",
           "args": { "text": { "type": "string", "required": true } }
         },
         "children": [
           {
             "id": "echo-post",
             "primitive": "post-response",
             "config": { "text": "{{args.text}}" }
           }
         ]
       }
     }
   }
   ```
3. **`triggers`** — An array of background trigger primitive instances (`schedule-task` or `webhook-receive`). Each trigger executes its child primitive pipeline when fired.
   ```json
   {
     "triggers": [
       {
         "id": "daily-trigger",
         "primitive": "schedule-task",
         "config": { "name": "daily-checkin", "cron": "{cron}", "timezone": "{timezone}" },
         "children": [
           {
             "id": "fetch-setting",
             "primitive": "settings-read",
             "config": { "key": "message", "scope": "user" },
             "children": [
               {
                 "id": "post-reminder",
                 "primitive": "post-response",
                 "config": { "text": "{{.}}", "roomId": "{roomId}" }
               }
             ]
           }
         ]
       }
     ]
   }
   ```

For engine-level dispatch rules and runtime event contexts, refer to [`docs/spec.md`](spec.md).

## Writing a recipe test

Every recipe in the library ships with a unit test suite located in `packages/recipes/tests/unit/recipes/<recipe-id>.spec.js`.

Recipe tests verify library scanning, slot/setting declarations, capability mapping, compiler emission, and runtime execution using the shared test helper [`packages/recipes/tests/unit/recipes/_helpers/load-emitted-bot.js`](../tests/unit/recipes/_helpers/load-emitted-bot.js).

A typical recipe execution test compiles the recipe, loads the emitted `bot.js` with `loadEmittedBot`, invokes a command or handler, and asserts on the recorded output:

```js
test('the echo command posts the provided text to the room', async () => {
  const script = await compile(LIB_ROOT, { recipeId: 'echo-command', recipeVersion: '1.0.0', slots: {} }, { botId: 'test-bot', label: 'Echo' })
  const { config, ctx, posts } = loadEmittedBot(script.code)
  const reader = { get: (key) => key === 'text' ? 'Hello World' : undefined }
  await config.commands.echo.handler(ctx, reader)
  assert.equal(posts.length, 1)
  assert.equal(posts[0].text, 'Hello World')
})
```

The test pattern is uniform across all existing recipes in the library.

## Known gaps

When designing new recipes, be aware of the current limitations in v1 primitives as defined in [`docs/spec.md`](spec.md) §13:

- **No `keyed-delete` primitive**: There is currently no primitive to delete persistent storage entries from a recipe.
- **No storage key enumeration**: Keyed storage cannot enumerate or list saved keys. Consequently, a `list` or `keys` command cannot be implemented in a recipe.
- **Room settings require room context**: `settings-read` with `scope: 'room'` requires an active `ctx.room` context. Background triggers (`schedule-task`, `webhook-receive`) do not run in a room context and cannot read room-scoped settings without explicit room overrides.
- **`post-response` requires room ID in background triggers**: When `post-response` runs inside a trigger handler, `ctx.room` is absent. The target `roomId` must be explicitly specified via a slot or setting template.
- **`queue-for-operator` response flow unimplemented**: The `queue-for-operator` primitive enqueues requests, but the operator decision response loop is deferred in v1. Do not use it in production recipes yet.
- **`llm-complete` endpoint configuration**: The engine does not currently provide a default managed LLM proxy endpoint. Recipes using `llm-complete` must supply a `baseUrl` either hardcoded or via a build slot.

## Adding a recipe to the library

Follow this checklist when contributing a new recipe:

1. **Create the recipe directory**:
   Create `packages/recipes/recipes/<recipe-id>/` where `<recipe-id>` is in kebab-case (for example, `packages/recipes/recipes/my-recipe/`).
2. **Create `recipe.json`**:
   Write the recipe definition. Set `id` to match the directory name and set `version` to `"1.0.0"`. Declare all required capabilities.
3. **Create `recipe.md`**:
   Write human-readable documentation explaining what the recipe does, its slots/settings, and its operational limits.
4. **Create the test file**:
   Create `packages/recipes/tests/unit/recipes/<recipe-id>.spec.js`. Include tests for scanning, compilation, command/handler behavior, and error handling using `loadEmittedBot`.
5. **Run tests and verification**:
   Run the full test suite and linter:
   ```bash
   pnpm --filter @atoll/recipes test:unit
   pnpm --filter @atoll/recipes lint
   ```

A recipe is considered **verified** when:
- Its `recipe.json` validates against the recipe schema during library scanning without errors.
- Every primitive referenced in its composition exists in the primitive catalog.
- Its declared `capabilities` array is a superset of all capabilities required by its primitives.
- Its unit test suite passes cleanly.
