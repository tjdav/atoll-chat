# Plugin Documentation

> **Component prerequisite:** Every component must wrap its export in `defineComponent` from `'coralite'`. See [i18n.md](./i18n.md) for the pattern and the enforcement test.

Each plugin that ships with the client has a usage guide in this directory.

| Plugin | Guide | Purpose |
|---|---|---|
| `extensions` | [extensions.md](./extensions.md) | Atoll's extension system: `defineExtension`, the registry, and `ctx`. |
| `i18n` | [i18n.md](./i18n.md) | Translation, locale detection, and the `t()` and `strings()` helpers. |

New plugin tasks add their guide here in the same commit that lands the plugin.
