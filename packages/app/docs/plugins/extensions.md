# Extension System Usage Guide (`@atoll/extend`)

## Prerequisite: `defineComponent` & `i18n` Patterns

- **`defineComponent` Rule:** Every component's `<script type="module">` block MUST `import { defineComponent } from 'coralite'` and `export default defineComponent({ ... })`.
- **`i18n` Pattern:** Every extension component with user-facing strings MUST follow the four-part pattern documented in [i18n.md](./i18n.md) (underscore translation keys, `server({ i18n })` state seeding, getter reads from state, `client({ i18n, signal })` locale subscriptions).

---

## 1. Overview

Atoll extensions enable modular feature development across the messenger client interface. The extension system allows first-party and third-party modules to extend shell views (rail, list, detail), contribute custom slots, publish/subscribe to public events, manage isolated persistent state, and define custom preferences and session types.

`@atoll/extend` is the SDK package that provides extension normalization, shape validation, the central `ExtensionRegistry`, and the invocation context (`ctx`) factory.

---

## 2. The Extension Object

An extension is declared as a plain JavaScript object passed to `defineExtension(ext)`.

### Full Extension Shape

```javascript
{
  // Required fields
  id: 'vendor.my-extension',          // String: ^[a-z0-9]+(\.[a-z0-9-]+)+$ ('core.' reserved)
  apiVersion: '1.0.0',                 // String: Semver version of extension spec
  hostApi: '2.0.0',                    // String: Min host API version required
  detail: {                            // Object: Primary detail surface
    route: 'my-feature',               // String: ^[a-z][a-z0-9-]*$
    component: 'my-feature-detail',    // String: Custom element tag name
    title: 'My Feature',               // String | Function: Surface title
    surfaces: ['panel'],               // Optional Array<String>: ['panel', 'full']
    defaultSurface: 'panel',           // Optional String: Default surface presentation
    back: 'auto',                      // Optional String: 'auto' | 'close' | 'none'
    actions: [],                       // Optional Array<Object>: Action descriptors
    slots: {},                         // Optional Object: Slot fill mapping
    scope: {},                         // Optional Object: Scope restrictions
    settings: null,                    // Optional Object: Settings descriptor
    empty: null,                       // Optional Component: Empty state fill
    loading: null,                     // Optional Component: Loading state fill
    error: null                        // Optional Component: Error state fill
  },

  // Optional fields
  label: 'My Feature',                 // String | Function: Required when rail is declared
  permissions: [],                     // Array<String>: Required capabilities
  rail: {                              // Object: Rail navigation button
    icon: { name: 'sparkles' },        // Object: Icon descriptor ({ name: string })
    order: 100,                        // Number: Numeric sort key ascending
    badge: null,                       // Optional Badge descriptor or getter
    mobile: { placement: 'more' },     // Optional Mobile navigation placement
    visible: () => true                // Optional Function: Visibility predicate
  },
  list: {                              // Object: Secondary list panel surface
    route: 'my-feature-list',          // String: ^[a-z][a-z0-9-]*$
    component: 'my-feature-list-panel',// String: Custom element tag name
    title: 'My Feature List',          // String | Function: Surface title
    actions: [],                       // Optional Array<Object>
    slots: {},                         // Optional Object
    empty: null,                       // Optional Component
    loading: null,                     // Optional Component
    error: null                        // Optional Component
  },
  slots: [],                           // Array<Object>: Contributed slot fills
  emits: [],                           // Array<Object>: Internal custom events
  publicEvents: [],                    // Array<Object>: Public cross-extension events
  listens: [],                         // Array<Object>: Event listeners
  sessions: [],                        // Array<Object>: Session type definitions
  preferences: [],                     // Array<Object>: Preference schema definitions
  locales: null,                       // Object: Extension locale dictionary overrides
  assets: [],                          // Array<String>: Static asset URLs
  onRegister: null,                    // Function: Lifecycle hook on registration
  onActivate: null,                    // Function: Lifecycle hook on activation
  onDeactivate: null                   // Function: Lifecycle hook on deactivation
}
```

---

## 3. `defineExtension(ext)`

`defineExtension(ext)` is the entry point for extension authors. It validates the raw extension shape, applies standard defaults to optional fields, attaches internal SDK metadata (`_sdkApiVersion`), and returns the normalized extension object.

```javascript
import { defineExtension } from '@atoll/extend'

export default defineExtension({
  id: 'vendor.calendar',
  apiVersion: '1.0.0',
  hostApi: '2.0.0',
  detail: {
    route: 'calendar',
    component: 'calendar-view',
    title: 'Calendar'
  }
})
```

- **Validation:** Throws an `Error` if required fields are missing or malformed (`id`, `apiVersion`, `hostApi`, `detail`, `detail.route`, `detail.component`, `detail.title`), or if `rail` is declared without `label`.
- **Prefix Guard:** The `core.` prefix is reserved for first-party Atoll extensions. Third-party extensions starting with `core.` are rejected.

---

## 4. The ExtensionRegistry API

`ExtensionRegistry` is the central store for registered extensions. It is managed by the Coralite extension plugin.

```javascript
import { ExtensionRegistry } from '@atoll/extend'

const registry = new ExtensionRegistry()
registry.add(normalizedExt)

registry.get('vendor.calendar')      // Returns normalized extension or undefined
registry.has('vendor.calendar')      // Returns boolean
registry.list()                     // Returns frozen array in registration order
registry.byRailOrder()              // Returns frozen array with rail sorted by order
registry.ownerOfRoute('calendar')   // Returns extension owning detail.route
registry.size()                     // Returns total registration count
```

---

## 5. `ctx` (Invocation Context)

`ctx` is constructed fresh per invocation point when an extension callback or view is executed. It provides access to the extension's context, parameters, and host services.

### `ctx` Surface API

| Field | Type | Availability | Backing Service / Plugin |
|---|---|---|---|
| `id` | `string` | **Available** | Extension ID |
| `surface` | `'rail' \| 'list' \| 'panel' \| 'full' \| null` | **Available** | Invocation parameter |
| `scope` | `object \| null` | **Available** | Invocation parameter |
| `selection` | `object \| null` | **Available** | Invocation parameter |
| `position` | `string \| null` | **Available** | Invocation parameter |
| `platform` | `'desktop' \| 'tablet' \| 'mobile'` | **Available** | Environment default / service |
| `capabilities` | `object \| undefined` | **Available** | Capabilities service |
| `state` | `object` | **Available** | Local extension state |
| `$state` | `object \| undefined` | Pending | Global State Plugin |
| `storage` | `{ get, set, delete, clear }` | Pending | Extension Storage Plugin |
| `preferences` | `{ get, set, delete, subscribe }` | Pending | Preferences Plugin |
| `navigate` | `(target: string) => void` | Pending | Router Plugin |
| `back` | `() => void` | Pending | Router Plugin |
| `present` | `(target: string) => void` | Pending | Router Plugin |
| `dismiss` | `() => void` | Pending | Router Plugin |
| `toast` | `(msg: string) => void` | Pending | Toast Plugin |
| `notify` | `(opts: object) => void` | Pending | Notification Plugin |
| `openExternal` | `(url: string) => void` | Pending | External Link Plugin |
| `asset` | `(path: string) => string` | Pending | Asset Plugin |
| `hasPermission` | `(perm: string) => boolean` | Pending | Permission Plugin |
| `fetch` | `(url: string, init?: object) => Promise<Response>` | Pending | Network Plugin |
| `fetchUserUrl` | `(url: string, init?: object) => Promise<Response>` | Pending | Network Plugin |
| `t` | `(key: string, vars?: object) => string` | Pending | i18n Plugin Integration |

### Missing Service Guard

Calling an accessor for an unsupplied service throws an explicit error detailing the missing plugin:

```javascript
// Example when router plugin is not registered:
ctx.navigate('/calendar')
// Throws: Error("ctx.navigate is not available. The router plugin is not registered.")
```

---

## 6. Component Location & Tag Naming

Extension components live under `src/components/` in subdirectories organized by convention:

```
packages/app/src/components/
├── extensions/
│   └── calendar/
│       ├── calendar-view.html
│       └── calendar-panel.html
```

- **Discovery:** Coralite's `components: 'src/components'` configuration recursively discovers and registers all `.html` component files under `src/components/`.
- **Tag Naming:** Custom element tag names must be hyphenated valid custom element names (e.g. `calendar-view`, `calendar-panel`).

---

## 7. The Four Surfaces

Extensions contribute views to four primary shell surfaces:

1. **Rail:** Declared via `rail: { icon, order, ... }`. Places an icon button on the left navigation rail.
2. **List Panel:** Declared via `list: { route, component, title, ... }`. Renders in the middle panel list container (`320–400px`).
3. **Detail Panel:** Declared via `detail: { route, component, title, ... }`. Renders in the main right panel detail container.
4. **Full Surface:** Presentation mode specified in `detail.surfaces = ['full']`.

*Note: Shell container wiring (`rail-host` and `surface-host` consuming `ExtensionRegistry`) arrives in follow-on tasks.*

---

## 8. Slots, Events, Sessions, Preferences

- **Slots:** Extensions register slot fills in `slots[]` to inject content into host extension points.
- **Events:** Custom events are published via `emits[]` and listened to via `listens[]`. Cross-extension public events are declared in `publicEvents[]`.
- **Sessions:** Session types contributed to room calling/whiteboard sessions are declared in `sessions[]`.
- **Preferences:** Extension settings and schema are declared in `preferences[]`.

---

## 9. The `defineComponent` Prerequisite

Every extension component must export its definition wrapped with `defineComponent`:

```html
<template id="calendar-view">
  <section class="calendar">
    <h1>Calendar Extension</h1>
  </section>
</template>

<script type="module">
  import { defineComponent } from 'coralite'

  export default defineComponent({
    server({ state }) {
      return { ready: true }
    }
  })
</script>
```

---

## 10. The i18n Prerequisite

Extension components containing translatable text must follow the i18n component pattern:

```html
<script type="module">
  import { defineComponent } from 'coralite'

  export default defineComponent({
    server({ i18n }) {
      return {
        ...i18n.strings(['calendar_title_label']),
        locale: i18n.getLocale()
      }
    },
    getters: {
      titleLabel: ({ state }) => state.calendar_title_label
    },
    client({ state, i18n, signal }) {
      i18n.subscribeLocale((locale) => {
        state.locale = locale
        Object.assign(state, i18n.strings(['calendar_title_label']))
      }, { signal })
    }
  })
</script>
```

---

## 11. What Is Not Implemented Yet

The following capabilities are provided by follow-on tasks:

- **Deep Build-Time Validation (C-CHAT-3):** Route uniqueness checks, slot resolution, event schema matching, circular mount detection, and the vocabulary command.
- **Shell UI Wiring:** `rail-host` and `surface-host` rendering extension lists and routing views.
- **First-Party Extensions (C-CHAT-4):** First-party extension implementations (`core.chat`, `core.media`, etc.).
- **Backing Service Plugins:** Router (`navigate`, `present`), Storage (`ctx.storage`), Preferences (`ctx.preferences`), Toast/Notifications (`ctx.toast`, `ctx.notify`), Network Proxy (`ctx.fetch`).
