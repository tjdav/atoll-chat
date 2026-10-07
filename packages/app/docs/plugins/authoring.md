# Plugin Authoring Guide

This guide describes how to author Coralite plugins for `@atoll/app`.

## 1. Overview

A plugin in Coralite is a modular unit that extends server and client application contexts.
Each plugin declares a unique `name` which acts as its namespace on `ctx` (e.g. `ctx.storage`, `ctx.i18n`).

Coralite uses a two-phase context resolver model:
- **Phase 1 (Module/Context Bootstrap):** Evaluated when the context factory initializes. Dynamic imports (`import()`) and singleton state initialization happen here.
- **Phase 2 (Instance Resolver):** Evaluated per request or component lifecycle call, returning context functions and accessors.

## 2. Factory Signature

Plugins are created using a factory function that returns a `definePlugin` object:

```javascript
import { definePlugin } from 'coralite'

/**
 * Custom plugin factory.
 *
 * @param {object} [options] - Plugin options.
 * @returns {import('coralite').Plugin} Plugin instance.
 */
export default (options = {}) => {
  return definePlugin({
    name: 'custom',
    server: {
      context: (pluginContext) => (instanceContext) => ({ ... })
    },
    client: {
      config: options,
      context: async (pluginContext) => {
        return (instanceContext) => ({ ... })
      }
    }
  })
}
```

## 3. The Plugin Config Pattern ⚠ Framework Invariant

To pass build-time data (such as SQL migration files, feature flags, or API base URLs) from Node.js server initialization to client-side runtime contexts, you **must** use `client.config`.

- `client.config` is a sibling of `client.context` inside the `client` object.
- Coralite serializes `client.config` into the client bundle at build time.
- The context resolver receives the serialized config object as `pluginContext.config`.
- `client.config` must contain only serializable plain values: strings, numbers, booleans, arrays, and plain objects.
- **Do not read `options` directly inside `client.context`.** `options` is evaluated at build time in Node and is NOT serialized into client closures.

## 4. Worked Example — The Storage Plugin

### Incorrect Pattern (Factory Option Closure):

```javascript
// BAD: options is not serialized into client bundle!
export default (options = {}) => definePlugin({
  name: 'storage',
  client: {
    context: async (pluginContext) => {
      const db = createDb({ dbName: options.dbName, migrations: options.migrations })
      return () => ({ open: () => db.open() })
    }
  }
})
```

### Correct Pattern (`client.config`):

```javascript
// GOOD: client.config is serialized and delivered to pluginContext.config
export default (options = {}) => {
  const dbName = options.dbName ?? 'messenger'
  const migrations = options.migrations ?? []

  return definePlugin({
    name: 'storage',
    client: {
      config: { dbName, migrations },
      context: async (pluginContext) => {
        const activeDbName = pluginContext.config?.dbName ?? 'messenger'
        const activeMigrations = pluginContext.config?.migrations ?? []
        const db = createDb({ dbName: activeDbName, migrations: activeMigrations })
        return () => ({ open: () => db.open() })
      }
    }
  })
}
```

## 5. The Dynamic Import Pattern

Client-side code in `client.context` must use Phase 1 asynchronous dynamic imports (`await import(...)`) for browser-only dependencies (e.g., WASM DB drivers, repositories, UI stores). This prevents bundling client-only code into server SSR bundles or importing window/DOM primitives during SSR.

```javascript
client: {
  context: async (pluginContext) => {
    const [{ createDb }, { createRepositories }] = await Promise.all([
      import('../lib/db/index.js'),
      import('../lib/db/repositories/index.js')
    ])
    // ...
  }
}
```

## 6. Context Key Shape

Return context keys directly under the plugin namespace. Do not nest a wrapper key restating the plugin name.

- Correct: `ctx.storage.open()`, `ctx.storage.repos()`
- Incorrect: `ctx.storage.storage.open()`

## 7. Server Context

SSR runs in Node.js. `pluginContext.config` is also available on the server context resolver. Prefer reading from `pluginContext.config` or maintaining identical parameter access across server and client paths.

## 8. Failure Modes

| Failure Mode | Root Cause | Symptom | Resolution |
|---|---|---|---|
| Reading `options.X` inside `client.context` | Factory options are evaluated at build time in Node and not serialized | `options.X` evaluates to `undefined` in browser | Use `client.config` and read `pluginContext.config.X` |
| `client.config` containing functions / classes | Non-serializable values in config | Build serialization error or silent drop | Use plain serializable objects, arrays, and primitives |
| Redundant wrapper key returned | Nested object returned in instance resolver | Double-nested access like `ctx.storage.storage.open` | Return methods directly on instance resolver object |
| Static top-level import of client ESM | Importing browser DOM/WASM packages top-level in plugin file | `ReferenceError: window is not defined` on server | Move imports inside `client.context` using `await import()` |

## 9. Enforcement

- Unit tests in `packages/app/tests/unit/storage-plugin-config.test.js` verify `client.config` shape and context resolution source.
- Build-time script `pnpm check:migration-bundle` (`packages/app/scripts/check-migration-bundle.mjs`) verifies that all SQL migrations are delivered into the compiled JS bundle.

## 10. Reference

- Coralite `definePlugin` API Specification: [https://coralite.dev](https://coralite.dev)
- Client Specification: §4.4 (Plugin Configuration)
