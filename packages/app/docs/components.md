# Component Authoring Guide

This document establishes the canonical rules, architecture, and authoring guide for Coralite components in @atoll/app. Every component author must read and satisfy these rules before creating or modifying components.

Rules marked with ⚠ Framework invariant are enforced by the Coralite runtime — violating them causes runtime errors or silent failures. Unmarked rules are @atoll/app project conventions enforced by code review.

---

## 1. Overview

Components are the fundamental unit of UI in this application. They encapsulate template markup, component-scoped CSS styles, and reactive lifecycle logic.

Coralite uses a Light DOM model where component templates render directly inside custom HTML element host instances (`<conversation-row>`, `<messenger-boot>`, `<ui-icon>`, etc.). The host element acts as the interface boundary between the component and its parent consumer.

To ensure consistency, reactivity, and proper plugin integration, every component module MUST export its definition wrapped in `defineComponent` from `coralite`.

---

## 2. The Component's Shape

A Coralite component file is an HTML single-file component (`.html`) structured into three canonical blocks:

```html
<template id="my-component">
  <!-- Template HTML markup -->
</template>

<style>
  /* Component CSS styles */
</style>

<script type="module">
import { defineComponent } from 'coralite'

export default defineComponent({
  attributes: { ... },
  getters: { ... },
  style: { ... },
  server({ i18n }) { ... },
  client({ state, refs, emit, signal, i18n }) { ... }
})
</script>
```

### Block Responsibilities

- **`<template>` block**: Holds static HTML markup, template bindings (`{{ token }}`), `ref="..."` attributes for internal access, and optional `data-testid="..."` test hooks.
- **`<style>` block**: Contains CSS scoped to the component. Rules target `:host`, `:host([attr])`, or internal class names.
- **`<script type="module">` block**: Defines the component interface using `defineComponent(...)`.
  - `server()`: Runs during SSR to resolve initial data (e.g. initial i18n string dictionaries). Returns the state object.
  - `client()`: Runs on client hydration to attach reactive subscriptions, DOM listeners, and side effects.

### Execution Environments ⚠ Framework invariant

Block names are runtime guarantees:

| Block | Runs in | Module scope available | Plugin context |
|---|---|---|---|
| `server()` | Node (build/SSR) only | Yes | Yes |
| `client()` | Browser only | No | Yes |
| `getters` | Both | Server only | No |
| `style` | Both | Server only | No |
| `slots` | Both | Server only | No |

Two direct consequences:

1. **Module scope is stripped from the client bundle.** Top-level imports, consts, and helper functions are available inside `server()` but produce `ReferenceError` inside `client()` or inside a `getters` function that runs on the client. Any value needed on both sides must be authored on both sides, or dynamically imported inside `client()`.
2. **Plugin context is delivered to `server()` and `client()` only.** It is not delivered to `getters`, `style`, or `slots`. To surface plugin data in a template, compute it in `server()` and return it as state.

---

## 3. State and the Template

State is the single source of truth. All reactive dynamic data lives in the component's state.

### Where state comes from ⚠ Framework invariant

State is seeded exclusively by the return value of `server()`. `state` is not a valid top-level option in `defineComponent` — the runtime will warn and ignore it if written.

```js
export default defineComponent({
  attributes: { active: { type: String, default: 'false' } },
  server({ i18n }) {
    return {
      locale: i18n.getLocale(),
      errorMessage: ''
    }
  }
  // NOTE: no `state:` key — it would be ignored
})
```

Attributes declared in the `attributes` block also contribute to state as camelCase properties, but they are a separate mechanism from server-seeded state.

### Reading state in templates

- **Templates read state keys directly.** A template may reference a state key: `{{ page_title }}`.
- **Getters compute derived values.** When a value requires computation, formatting, or cross-state derivation, expose it through a getter: `{{ formattedCount }}`.
- **No pass-through getters.** A getter that merely re-exposes a state key under a different name is redundant and prohibited (see Rule 12).
- **No expressions in templates.** Templates use flat mustache identifiers only. `{{ count + 1 }}`, `{{ user.name }}`, and `{{ format(x) }}` are all forbidden. Lift the computation into a getter.

### No conditional rendering ⚠ Framework invariant

There is no conditional rendering in Coralite. Every node in `<template>` is always present in the DOM. There is no `{{#if}}`, no `v-if`, no `*ngIf`, and no template-level conditional of any kind.

For state-based visibility, use:

- `hidden="{{ noError }}"` driven by a getter — for toggling a small block.
- A slot builder returning `[]` when empty — for optional wrappers around projected content.
- `::slotted([slot="..."])` — when no wrapper element is needed.
- Native `<details>`, `<dialog>`, or `popover` — for disclosure, modal, and popover semantics.
- A style getter emitting a CSS custom property — for reveal animations or state-driven display.

Never reach for imperative DOM insertion inside `client()` as a visibility mechanism.

### Awaiting reactive settlement

Coralite batches state mutations within a microtask. After mutating state, `await updateComplete` before querying the DOM:

```js
state.count += 1
await updateComplete
// DOM is settled
```

Never rely on `setTimeout` or `requestAnimationFrame` for DOM synchronization.

### No state duplication

Never mirror state into internal DOM properties or internal element `data-*` attributes. State is the single source of truth.

---

## 4. Host Attributes are the Public Interface

Host attributes define how parent components pass parameters to child components (e.g. `<ui-profile size="md" name="Alice">` or `<conversation-row is-unread>`).

- **Schema Definition**: Host attributes are declared in the `attributes` block of `defineComponent`.
- **Reflection (`reflect: true`)**: When an attribute option includes `reflect: true`, Coralite automatically reflects changes in `state[attr]` back to the host element's HTML attribute:
  - Boolean attributes write attribute presence/absence (`is-unread` present when true, absent when false).
  - String attributes write attribute values (`size="md"`).
- **Public Interface Boundary**: External consumers and parent CSS inspect host attributes, not internal component child nodes.

---

## 5. CSS State Hooks

All dynamic layout and state-driven styling MUST target reflected attributes on the host element.

### Preferred CSS Patterns

```css
/* Target boolean state on the host */
:host([is-unread]) .row__name {
  font-weight: var(--weight-bold);
}

/* Target string state on the host */
:host([size="sm"]) .profile {
  width: 1.75rem;
  height: 1.75rem;
}
```

### Prohibited Patterns

- Do NOT add internal `data-*` attributes to internal markup nodes for CSS targeting (e.g., `.row[data-unread="true"]` is forbidden).
- Do NOT imperatively add/remove CSS classes via `classList.add(...)` or `classList.toggle(...)` in `client()`.

---

## 6. Testing Attributes

To support automated end-to-end and component testing without coupling tests to implementation details:

- **Semantic Queries First**: Tests MUST prefer standard semantic queries (`getByRole`, `getByLabel`, `getByText`).
- **`data-testid` Fallback**: When no accessible role or label exists, use `data-testid="..."`.
- **Verbatim Authored**: `data-testid` values MUST be static, verbatim strings authored in the `<template>` block. Never bind dynamic state to `data-testid`.
- **`CORALITE_PRESERVE_TESTID` Policy**: Test IDs are preserved in production test builds when `CORALITE_PRESERVE_TESTID=true`.
- **Prohibition**: Internal `data-*` attributes (e.g., `data-room-id`, `data-state`, `data-unread`) are strictly forbidden as test hooks.

---

## 7. ARIA Attributes

Accessibility attributes (`aria-*`, `role="..."`) serve assistive technologies.

- **Semantic Purpose Only**: Set ARIA attributes for accessibility compliance (e.g. `aria-current="page"`, `aria-label="..."`, `role="alert"`).
- **Not Test Hooks / State Mirrors**: ARIA attributes must not be hijacked as test hooks or internal CSS state mirrors.
- **Reflected ARIA**: Use standard getter bindings (`aria-hidden="{{ hidden }}"`) or semantic HTML elements (`<button>`, `<nav>`, `<main>`).

---

## 8. Events

Components communicate upward to parent containers via custom events using `emit(...)`.

- **`emit(eventName, detail)`**: Provided in the `client()` context parameter. Defaults to `{ bubbles: true, composed: true }`.
- **Standard Event Names**:
  - Auth events: `auth:view-change`, `auth:login:submit`, `auth:register:submit`, `auth:recover:submit`.
  - App events: `app:ready`, `app:error`.
  - Component events: `select`, `change`.
- **DOM Event Bubbling**: Emitted events bubble up the Light DOM tree, allowing ancestor containers to handle them.
- **Binding listeners**: Always pass `{ signal }` to `addEventListener`:

  ```js
  refs('btn').addEventListener('click', handler, { signal })
  ```

  The signal is aborted on component disconnect, which removes the listener automatically.

---

## 9. Internationalization (i18n)

Every component rendering user-facing text MUST conform to the four-part i18n pattern documented in `packages/app/docs/plugins/i18n.md`:

1. **`server({ i18n })` block**: Fetch initial localized string keys synchronously using `i18n.strings([...])`.
2. **Template binding**: Bind dictionary keys directly in template mustache placeholders (`{{ auth_login_title }}`).
3. **`client({ state, i18n, signal })` subscription**: Subscribe to locale change events with `i18n.subscribeLocale(syncLocale, { signal })`.
4. **Locale Sync Guard**: Check `if (state.locale !== i18n.getLocale()) syncLocale(i18n.getLocale())` on client hydration to reconcile SSR and client locale state.

### Why the pattern bridges through state ⚠ Framework invariant

Plugin context is delivered only to `server()` and `client()`. It is not delivered to `getters`, `style`, or `slots`. This is why the i18n pattern resolves translations into state via `server()` and reads them from state in getters.

Writing `heading: ({ state, i18n }) => i18n.t('heading')` will produce `undefined` — `i18n` is not present on the getter context object.

The key list must be authored in both `server()` and `client()`. Module-scope constants cannot be shared across the boundary — the list in `client()` must be its own literal array.

---

## 10. Modal and sheet primitive

The application provides a single shared primitive for top-layer modals and bottom sheets: `<ui-sheet>`.

### Purpose
`<ui-sheet>` encapsulates a native HTML `<dialog>` element providing accessibility, top-layer rendering, native Escape handling, native focus trapping, and optional backdrop dismissal.

### Attribute Contract

| Attribute | Type | Default | Reflected | Description |
|---|---|---|---|---|
| `open` | Boolean | `false` | Yes | Controls dialog visibility and top-layer modal state. |
| `variant` | String | `'center'` | Yes | Layout mode: `'center'` (desktop/centered modal) or `'bottom'` (mobile bottom sheet). |
| `title` | String | `''` | No | Header title text. |
| `ariaLabel` | String | `''` | No | Accessible name fallback when title is omitted. |
| `showClose` | Boolean | `true` | No | Shows or hides the header close button (`✕`). |
| `closeLabel` | String | `'Close'` | No | Accessible label for the close button. |
| `dismissible` | Boolean | `true` | No | Enables Escape key and backdrop click dismissal. |

### Events

- `sheet:close` — Emitted when the sheet is closed by any means (close button, Escape key, backdrop click, or setting `open = false`).

### Usage Example

```html
<ui-sheet title="Room Settings" variant="center" open="{{ isSettingsOpen }}">
  <div class="settings-content">
    <p>Room configuration controls go here.</p>
  </div>
</ui-sheet>
```

---

## 11. The Authoring Checklist

Every new or modified Coralite component MUST satisfy this checklist:

1. ☐ Export wrapped in `defineComponent(...)`.
2. ☐ State is seeded by `server()`'s return value. No top-level `state:` option.
3. ☐ Getters compute or format; no pass-through aliases. Templates read state keys directly when no computation is needed.
4. ☐ No expressions, function calls, or dot notation in template mustache tokens.
5. ☐ All state-driven CSS relies on `:host([attr])` with `reflect: true` attributes.
6. ☐ No internal `data-*` attributes exist in `<template>` except `data-testid` (or explicit `<!-- coralite-ignore-data-attributes -->` pragma for third-party integrations).
7. ☐ Tests rely on accessible role/label queries or verbatim `data-testid`.
8. ☐ User-facing strings use the four-part i18n pattern with `subscribeLocale` passing `{ signal }`.
9. ☐ No module-scope identifiers (imports, consts, helper functions) referenced inside `client()` or inside a getter that runs on the client.
10. ☐ No plugin context accessed from getters, `style`, or `slots`.
11. ☐ No environment-detection guards (`typeof window !== 'undefined'`) inside `client()` or `server()`.
12. ☐ `client()` function uses straight-line async/await without inner anonymous async IIFEs.
13. ☐ No state mutations inside `observe()` callbacks.
14. ☐ `pnpm test:batch unit-smoke` (including `components-data-attrs.test.js`) passes cleanly.

---

## 12. Failure Modes & Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Pattern |
|---|---|---|
| `data-unread="{{ isUnread }}"` on internal button | Duplicates state, creates dual source of truth, bloats DOM | Set `reflect: true` on `isUnread` attribute; style with `:host([is-unread])` |
| `element.dataset.storageReady = 'true'` in `client()` | Imperative DOM mutation bypassing component state | Update component state property (`state.storageReady = true`) with reflected attribute |
| `classList.toggle('active', isReady)` in `client()` | Bypasses CSS host selectors and component schema | Style using `:host([ready])` or `:host([active])` with `reflect: true` |
| `get myValue() { return this.state.myValue }` | Pass-through getter; redundant alias | Read `state.myValue` directly in the template |
| `{{#if condition}}` or `v-if` in template | Coralite has no conditional rendering — all nodes are always in the DOM | Use `hidden="{{ noX }}"` with a getter, a slot builder returning `[]`, or a native `<details>`/`<dialog>`/`popover` |
| `heading: ({ state, i18n }) => i18n.t(...)` in a getter | Plugin context is not delivered to getters; `i18n` is `undefined` | Bridge translations into state via `server()`; read from state in getters |
| `state: { count: 0 }` as a top-level option | Ignored by the runtime; state never initializes | Seed state via `server()`'s return value |
| Module-scope const or import referenced in `client()` | Module scope is stripped from the client bundle — `ReferenceError` at runtime | Author the value inline in `client()` or use dynamic `await import(...)` |
| `if (typeof window !== 'undefined')` inside `client()` | Dead code — `client()` only runs in the browser. Can silently break fallback logic | Remove the guard |
| Mutating `state.x` inside `observe('y', cb)` | Infinite reactive loop, `CORALITE-E302` diagnostic | Mutate state in event handlers only; reserve `observe()` for external systems |
| `i18n.subscribeLocale(cb)` without `{ signal }` | Memory leak on component disconnect | Pass `i18n.subscribeLocale(cb, { signal })` |
| `(async () => { await ... })()` inside `client()` | Unhandled promise rejections, breaks component teardown | Declare `client: async ({ ... }) => { ... }` directly |
| Plugin resolver returns `{ icons: { get, list } }` for plugin named `icon` | Doubly-nested context; consumers must write `ctx.icon.icons.get` | Plugin name is the namespace — return `{ get, list }` directly |
| Top-level static import of client-only libraries | `ReferenceError` on the client — module scope is not included in the client bundle | Use dynamic `await import(...)` inside `client()` |

---

## 13. Enforcement

Compliance with this guide is enforced automatically at build and test time:

- `packages/app/tests/unit/components-defineComponent.test.js`: Enforces Rule 10 (`defineComponent` wrapper on all component module exports).
- `packages/app/tests/unit/components-data-attrs.test.js`: Enforces Rule 4 & Rule 8 (prohibits internal `data-*` attributes in templates except `data-testid`).
- `packages/app/tests/unit/i18n.test.js` & `i18n-plugin.test.js`: Enforces Rule 11 & Rule 14 (i18n contract, key resolution, and signal-based unsubscribing).
- `pnpm check-batches`: Ensures all test files are properly registered in batch manifests.

---

## The 21 Canonical Rules

Rules marked ⚠ are Coralite framework invariants — violating them causes runtime errors or silent failures. Unmarked rules are @atoll/app project conventions enforced by code review.

- **Rule 1 — State is the source of truth.** Component state is seeded by `server()`'s return value. The template reads state keys directly, or reads getters that derive from state. The `client()` block reads and writes state. No duplication elsewhere. ⚠
- **Rule 2 — State is seeded by `server()`.** `state` is not a top-level `defineComponent` option — the runtime ignores it. ⚠
- **Rule 3 — CSS state hooks go on the host.** When a state value must drive CSS, reflect it as a host attribute with `reflect: true`. The component's scoped CSS reads `:host([attr])` or `:host([attr="value"])`. The internal element does not carry a `data-*` attribute.
- **Rule 4 — Host attributes are the public interface.** A consumer sets host attributes (`<conversation-row is-unread>`). The component's state reflects them. Reflected attributes write back to the host for CSS and tests.
- **Rule 5 — `data-testid` is the only sanctioned `data-*` in a template.** Static, authored verbatim, never dynamic. Queried by Playwright's `getByTestId`. Preserved across builds when `CORALITE_PRESERVE_TESTID=true`.
- **Rule 6 — Prefer semantic queries over `data-testid`.** `getByRole` with an accessible name, `getByLabel`, `getByText`. Use `data-testid` only when no semantic query is available.
- **Rule 7 — `aria-*` attributes are semantic.** Set them for assistive technology. They are not test hooks and not state mirrors. If an element has a role and a state (e.g. `aria-current`), use the ARIA attribute, not a `data-*` twin.
- **Rule 8 — No dead attributes.** If an attribute is not consumed by CSS, a test, or an assistive technology, remove it.
- **Rule 9 — No imperative state-mirroring.** Do not write to a `data-*` attribute from `client()` to expose state. Reflect the state on the host instead.
- **Rule 10 — No imperative class toggling for state.** Classes are static in the template. State-driven layout uses host reflected attributes with `:host([...])` selectors.
- **Rule 11 — `defineComponent` is required.** Every component wraps its export. The enforcement test is `packages/app/tests/unit/components-defineComponent.test.js`. ⚠
- **Rule 12 — No pass-through getters.** A getter computes; it does not alias a state key. Read state keys directly in templates when no computation is needed. ⚠
- **Rule 13 — No expressions in templates.** Use flat mustache identifiers only. Lift all computation into getters. ⚠
- **Rule 14 — No conditional rendering.** Every template node is always in the DOM. Use `hidden="{{ noX }}"` with a getter, slot builders, `::slotted()`, or native elements for conditional presentation. ⚠
- **Rule 15 — Plugin context is not available in getters, `style`, or `slots`.** Delivered to `server()` and `client()` only. Bridge through state. ⚠
- **Rule 16 — Plugin context keys are returned directly.** The plugin's name is the namespace. No wrapper object restating the plugin name. ⚠
- **Rule 17 — Module scope is server-only.** Top-level imports, consts, and helper functions are stripped from the client bundle. Any value needed on both sides must be authored on both sides, or dynamically imported inside `client()`. ⚠
- **Rule 18 — No environment guards inside single-environment blocks.** `typeof window !== 'undefined'` inside `client()` is dead code. `typeof process !== 'undefined'` inside `server()` is redundant. Only getters, `style`, and `slots` legitimately need environment checks. ⚠
- **Rule 19 — The four-part i18n pattern is required.** Every component with user-facing strings follows `packages/app/docs/plugins/i18n.md`.
- **Rule 20 — `subscribeLocale` (and all plugin subscription APIs) accept `{ signal }`.** The signal unsubscribes on disconnect. Plugin subscription APIs own their cleanup wiring — callers pass `{ signal }`, they do not call `addEventListener('abort', ...)` manually.
- **Rule 21 — `client()` may be `async`; do not wrap in an anonymous IIFE.** Top-level `await` is valid inside an async client block. Also: never mutate state inside an `observe()` callback — it causes infinite reactive loops and triggers `CORALITE-E302`. ⚠
