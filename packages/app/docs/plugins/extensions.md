# Extension System Usage Guide (`@atoll/extend`)

## Prerequisite: `defineComponent` & `i18n` Patterns

- **`defineComponent` Rule:** Every component's `<script type="module">` block MUST `import { defineComponent } from 'coralite'` and `export default defineComponent({ ... })`.
- **`i18n` Pattern:** Every extension component with user-facing strings MUST follow the four-part pattern documented in [i18n.md](./i18n.md) (underscore translation keys, `server({ i18n })` state seeding, getter reads from state, `client({ i18n, signal })` locale subscriptions).

---

## 1. Overview

Atoll extensions enable modular feature development across the messenger client interface. The extension system allows first-party and third-party modules to extend shell views (rail, list, detail), contribute custom slots, publish/subscribe to public events, manage isolated persistent state, and define custom preferences and session types.

`@atoll/extend` is the SDK package that provides extension normalization, shape validation, Phase 2 cross-extension link validation, the central `ExtensionRegistry`, vocabulary introspection, and the invocation context (`ctx`) factory.

---

## 2. First-Party Extensions

The application ships with ten first-party core extensions defined under `packages/app/src/extensions/<name>/index.js` and aggregated in `packages/app/src/extensions/index.js`.

| Extension ID | Rail | Routes | Session types | Status |
|---|---|---|---|---|
| `core.chat` | yes | `chats`, `chat` | — | definition + placeholder |
| `core.media` | yes | `media`, `media-viewer` | — | definition + placeholder |
| `core.documents` | yes | `documents`, `document` | — | definition + placeholder |
| `core.links` | yes | `links`, `link` | — | definition + placeholder |
| `core.calls` | yes | `calls`, `call` | — | definition + placeholder |
| `core.settings` | yes | `settings`, `settings-section` | — | definition + placeholder |
| `core.hangouts` | no | `sessions`, `session` | `voice` | definition + placeholder |
| `core.profile` | no | `profile` | — | definition + placeholder |
| `core.join` | no | `join` | — | definition + placeholder |
| `core.admin` | no | `admin`, `admin-section` | — | definition + placeholder |

*Note:* `room-settings` (overlay for `core.chat`) is deferred until its real-implementation task because the current SDK extension object shape supports a single `detail.route`. All components reference the shared `extension-placeholder` component until dedicated task implementations arrive.

---

## 3. Build-Time Validation

Validation is mandatory and runs automatically when `coralite.config.js` is loaded during development or build. If any validation rule fails, the config load throws an explicit error and halts execution.

### Phase 1: Per-Extension Shape Validation (`validate.js`)
- **Required fields:** Validates `id`, `apiVersion`, `hostApi`, `detail`, `detail.route`, `detail.component`, `detail.title`.
- **Prefix Guard:** The `core.` ID prefix is reserved for first-party Atoll extensions. Third-party extensions starting with `core.` are rejected.
- **Permissions:** Every permission must be present in the allowed list (`network`, `storage`).
- **Slots:** Validates target slot string format (`<shortId>.<slotName>`), non-reserved slots, component tag names, numeric ordering, and visibility predicate types.
- **Emits / Public Events:** Validates `<namespace>:<event-name>` naming and non-nested schema type definitions (`string`, `number?`, union types).
- **Listens:** Validates event name format and function handler presence.
- **Sessions:** Validates type string format, positive integer participant and room caps, heartbeat intervals, string metadata values, and nested signaling dictionaries.
- **Preferences:** Validates preference keys (`^[a-z][a-zA-Z0-9]*$`), non-reserved keys (`room_order`), non-reserved prefixes (`_system:`), allowed types (`string`, `number`, `boolean`, `object`, `array`), and optional labels.
- **Assets:** Validates non-empty `src` and `dest` string paths.
- **Component Tag Naming:** Non-`core.*` extensions must prefix custom element tag names with `x-<slug>-` where `<slug>` is the last segment of the extension ID (e.g. `x-calendar-view`).

### Phase 2: Cross-Extension Link Validation (`validate-link.js`)
- **Route Uniqueness:** Rejects duplicate `detail.route` or `list.route` declarations across extensions.
- **Route Collisions:** Rejects route collisions between detail and list surfaces.
- **Slot Resolution:** Every mounted slot target must resolve to a declared slot on a registered host extension.
- **Slot Fills:** Enforces single-extension fill restrictions when a slot declares `multiple: false`.
- **Unmatched Listeners:** Every listened event must be published by at least one extension's `emits` or `publicEvents`.
- **Event Schema Matching:** All emitters and listeners of an event must agree on its schema definition.
- **Duplicate Session Types:** Session types must be unique within an extension.
- **Reserved Preference Keys:** Prevents extensions from declaring reserved preference keys or prefixes.
- **Circular Slot Mounts:** Rejects circular slot mounting dependencies between extensions.
- **Warnings:** Emits warnings for rail order collisions, duplicate action icons in the same surface, and scope key type inconsistencies.

---

## 4. The Vocabulary Command

The offline vocabulary command aggregates and inspects the registered extensions, slots, events, routes, sessions, preferences, permissions, and available components.

### Execution

```bash
pnpm extensions:vocab
```

### Options & Flags

- **Human-Readable Output (Default):**
  ```bash
  pnpm extensions:vocab
  ```
- **Machine-Readable JSON Output:**
  ```bash
  pnpm extensions:vocab --json
  ```
- **Section Filtering:**
  ```bash
  pnpm extensions:vocab --section=routes
  pnpm extensions:vocab --json --section=events
  ```

### Output Sections

- **components:** Template IDs found under `src/components/`.
- **slots:** Declared slots and their mounted fillers sorted by order.
- **events:** Aggregate event schemas, emitters, receivers, and listeners.
- **routes:** Detail and list route mappings to owning extension IDs.
- **sessions:** Contributed room calling and session descriptors.
- **preferences:** Settings schema declarations.
- **permissions:** Aggregated active permissions.
- **icons:** Available Solar icons (populated when icon plugin lands).
- **platforms / surfaces:** Platform categories (`desktop`, `tablet`, `mobile`) and view surface modes (`panel`, `overlay`).
- **reserved:** System-reserved routes, preference keys, preference prefixes, and slots.

---

## 5. The Extension Object

An extension is declared as a plain JavaScript object passed to `defineExtension(ext)`.

```javascript
{
  id: 'vendor.my-extension',          // String: ^[a-z0-9]+(\.[a-z0-9-]+)+$ ('core.' reserved)
  apiVersion: '1.0.0',                 // String: Semver version of extension spec
  hostApi: '2.0.0',                    // String: Min host API version required
  detail: {                            // Object: Primary detail surface
    route: 'my-feature',               // String: ^[a-z][a-z0-9-]*$
    component: 'x-my-extension-detail',// String: Custom element tag name with x-<slug>- prefix
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
  label: 'My Feature',                 // String | Function: Required when rail is declared
  permissions: ['storage'],            // Array<String>: Required capabilities
  rail: {                              // Object: Rail navigation button
    icon: { name: 'sparkles' },        // Object: Icon descriptor ({ name: string })
    order: 100,                        // Number: Numeric sort key ascending
    badge: null,                       // Optional Badge descriptor or getter
    mobile: { placement: 'more' },     // Optional Mobile navigation placement
    visible: () => true                // Optional Function: Visibility predicate
  },
  list: {                              // Object: Secondary list panel surface
    route: 'my-feature-list',          // String: ^[a-z][a-z0-9-]*$
    component: 'x-my-extension-list',  // String: Custom element tag name
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
  assets: [],                          // Array<Object>: Static asset descriptors
  onRegister: null,                    // Function: Lifecycle hook on registration
  onActivate: null,                    // Function: Lifecycle hook on activation
  onDeactivate: null                   // Function: Lifecycle hook on deactivation
}
```

---

## 6. `defineExtension(ext)`

`defineExtension(ext)` normalizes and validates the raw extension object, applying standard defaults and attaching internal SDK metadata (`_sdkApiVersion`).

```javascript
import { defineExtension } from '@atoll/extend'

export default defineExtension({
  id: 'vendor.calendar',
  apiVersion: '1.0.0',
  hostApi: '2.0.0',
  detail: {
    route: 'calendar',
    component: 'x-calendar-view',
    title: 'Calendar'
  }
})
```

---

## 7. The ExtensionRegistry API

`ExtensionRegistry` is the central store for registered extensions, managed by the Coralite extension plugin.

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

## 8. `ctx` (Invocation Context)

`ctx` is constructed fresh per invocation point when an extension callback or view is executed.

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

---

## 9. What Is Not Implemented Yet

The following capabilities are provided by follow-on tasks:

- **Shell UI Wiring:** `rail-host` and `surface-host` rendering extension lists and routing views.
- **Backing Service Plugins:** Router (`navigate`, `present`), Storage (`ctx.storage`), Preferences (`ctx.preferences`), Toast/Notifications (`ctx.toast`, `ctx.notify`), Network Proxy (`ctx.fetch`).
