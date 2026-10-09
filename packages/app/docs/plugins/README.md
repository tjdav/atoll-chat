# Plugin Documentation

> **Component prerequisite:** Every component must wrap its export in `defineComponent` from `'coralite'`. See [i18n.md](./i18n.md) for the pattern and the enforcement test.

## Cross-cutting rule: plugin config

Build-time data (like SQL migrations) must be passed to the client via
`client.config`. Coralite serializes `client.config` into the client bundle
and delivers it to the context resolver as `pluginContext.config`. Reading
the factory's `options` directly inside `client.context` does not work —
`options` is not serialized.

See [authoring.md](./authoring.md) §3.

## Cross-cutting rule: plugin `client.context` imports

Plugin `client.context` functions are serialized into the client bundle. Static
top-level imports at the plugin file's top level are available in Node (SSR and
unit tests) but are not reliably hoisted into the serialized client bundle.

Every plugin whose `client.context` needs a value from another module must use
a Phase 1 async dynamic import:

```javascript
client: {
  context: async (pluginContext) => {
    const { someValue } = await import('../lib/some-module.js')
    // ...
    return (_instanceContext) => ({ /* context keys directly */ })
  }
}
```

The Phase 1 arrow is `async`. The Phase 2 arrow remains synchronous. The
context keys are returned directly — no wrapper key naming the plugin.

Each plugin that ships with the client has a usage guide in this directory.

| Plugin | Guide | Purpose |
|---|---|---|
| Authoring Guide | [authoring.md](./authoring.md) | Plugin authoring patterns, `client.config` delivery, and framework invariants. |
| `extensions` | [extensions.md](./extensions.md) | Atoll's extension system: `defineExtension`, the registry, and `ctx`. |
| `i18n` | [i18n.md](./i18n.md) | Translation, locale detection, and the `t()` and `strings()` helpers. |
| `router` | [router.md](./router.md) | In-page routing: query-param parsing, navigation, and change subscriptions. |
| `storage` | [storage.md](./storage.md) | SQLite persistence, backend abstraction, migration runner, and `meta` helpers. |
| `sync` | [sync.md](./sync.md) | User-scoped sync via `GET /users/me/sync`. |
| `floating` | [floating.md](./floating.md) | Floating UI positioning for popovers, context menus, and tooltips. |

New plugin tasks add their guide here in the same commit that lands the plugin.
