# Component Authoring Guide

This document establishes the canonical rules, architecture, and authoring guide for Coralite components in `@atoll/app`. Every component author must read and satisfy these rules before creating or modifying components.

Rules marked with **⚠ Framework invariant** are enforced by the Coralite runtime — violating them causes runtime errors or silent failures. Unmarked rules are `@atoll/app` project conventions enforced by code review.

---

## Table of Contents

1. [Overview](#1-overview)
2. [The Component's Shape](#2-the-components-shape)
3. [State and the Template](#3-state-and-the-template)
4. [Host Attributes](#4-host-attributes)
5. [Conditional Visibility & Presence](#5-conditional-visibility--presence)
6. [Slots](#6-slots)
7. [Context Protocol — provide / consume](#7-context-protocol--provide--consume)
8. [Observation and Reactive Settlement](#8-observation-and-reactive-settlement)
9. [Form-Associated Components](#9-form-associated-components)
10. [Error Boundaries](#10-error-boundaries)
11. [CSS State Hooks](#11-css-state-hooks)
12. [Testing Attributes](#12-testing-attributes)
13. [ARIA Attributes](#13-aria-attributes)
14. [Events](#14-events)
15. [Internationalization](#15-internationalization)
16. [Authoring Checklist](#16-authoring-checklist)
17. [Failure Modes & Anti-Patterns](#17-failure-modes--anti-patterns)
18. [Enforcement](#18-enforcement)
19. [The 22 Canonical Rules](#19-the-22-canonical-rules)
- [Appendix A — Modal and Sheet Primitive](#appendix-a--modal-and-sheet-primitive)

---

## 1. Overview

Components are the fundamental unit of UI in this application. They encapsulate template markup, component-scoped CSS styles, and reactive lifecycle logic.

Coralite uses a **Light DOM** model where component templates render directly inside custom HTML element host instances (`<conversation-row>`, `<messenger-boot>`, `<ui-icon>`, etc.). The host element acts as the interface boundary between the component and its parent consumer.

To ensure consistency, reactivity, and proper plugin integration, **every component module MUST export its definition wrapped in `defineComponent`** from `coralite`.

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
  slots: { ... },           // optional
  provide: { ... },         // optional
  consume: { ... },         // optional
  formAssociated: false,    // optional
  server({ i18n }) { ... },
  client({ state, refs, emit, signal, i18n, observe, updateComplete, slots, root, ... }) { ... },
  onError({ error, state }) { ... }   // optional
})
</script>
```

### Block Responsibilities

- **`<template>` block**: Holds static HTML markup, template bindings (`{{ token }}`), `ref="..."` attributes for internal access, and optional `data-testid="..."` test hooks.
- **`<style>` block**: Contains CSS scoped to the component. Rules target `:host`, `:host([attr])`, or internal class names.
- **`<script type="module">` block**: Defines the component interface using `defineComponent(...)`.

### The `defineComponent` Options

| Option | Purpose | Section |
|---|---|---|
| `attributes` | Host attribute schema and coercion | §4 |
| `server({ state, i18n, ... })` | SSR build-time execution; returns state seed | §3 |
| `client({ state, refs, emit, signal, i18n, observe, updateComplete, ... })` | Browser runtime execution | §3, §8, §14 |
| `getters` | Derived state, synchronous | §3 |
| `style` | Dynamic host CSS and CSS custom properties, synchronous | §3 |
| `slots` | Slot content transformation (build/server time) | §6 |
| `provide` | Supply a value for a context key | §7 |
| `consume` | Request a value for a context key | §7 |
| `formAssociated` | Opt into native form participation | §9 |
| `onError` | SSR component error boundary | §10 |

### Execution Environments ⚠ Framework invariant

Block names are runtime guarantees:

| Block | Runs in | Module scope available | Plugin context |
|---|---|---|---|
| Module scope (`<script type="module">`) | Node (build) only | Yes | — |
| `server()` | Node (build/SSR) only | Yes | Yes |
| `client()` | Browser only | **No** | Yes |
| `getters` | Both | Server only | **No** |
| `style` | Both | Server only | **No** |
| `slots` (build transform) | Server (build) only | Yes | **No** |

Two direct consequences:

1. **Module scope is stripped from the client bundle.** Top-level imports, `const`s, and helper functions are available inside `server()` but produce `ReferenceError` inside `client()` or inside a `getters` function that runs on the client. Any value needed on both sides must be authored on both sides, or dynamically imported inside `client()`.
2. **Plugin context is delivered to `server()` and `client()` only.** It is not delivered to `getters`, `style`, or `slots`. To surface plugin data in a template, compute it in `server()` and return it as state.

### Full `client()` Context Signature

For reference, the complete client context object provides:

```
{
  id, instanceId,
  root,                    // the host element
  state,                   // reactive state proxy
  errors,                  // validation error map
  refs(name),              // element lookup by ref attribute
  signal,                  // AbortSignal, aborted on disconnect
  observe(key, cb),        // state change subscription
  emit(name, detail, opts),
  internals,               // ElementInternals (if formAssociated)
  setFormValue, setValidity, checkValidity, reportValidity,
  validity, validationMessage, form,
  onFormReset, onFormDisabled, onFormRestore,
  updateComplete,          // Promise<boolean>
  slots,                   // slot content helpers
  // plus any registered plugin namespaces
}
```

Individual options are documented in the sections that follow. Components only destructure what they use.

---

## 3. State and the Template

**State is the single source of truth.** All reactive dynamic data lives in the component's `state`.

### Where state comes from ⚠ Framework invariant

State is seeded **exclusively by the return value of `server()`**. `state` is **not** a valid top-level option in `defineComponent` — the runtime will warn and ignore it if written.

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

### Getters ⚠ Framework invariant

Getters receive a **single unified context object** and MUST destructure it:

```js
getters: {
  // CORRECT
  formattedCount: ({ state }) => state.count.toLocaleString(),
  direction: ({ state }) => state.locale.startsWith('ar') ? 'rtl' : 'ltr',

  // WRONG — binds the context object itself to `state`
  brokenGetter: (state) => state.count
}
```

The getter context contains exactly `{ state, root, refs, slots, signal }`. No plugin context, no module scope on the client.

Getters must be **synchronous**. Async getters are not supported.

### Style block ⚠ Framework invariant

The `style` block maps CSS properties and CSS custom properties (`--*`) to either static values or synchronous functions. Unlike getters, style functions receive **`state` directly** as their first argument — not a context object.

```js
style: {
  '--theme-accent': (state) => state.theme === 'dark' ? '#0f172a' : '#f8fafc',
  '--error-display': (state) => state.hasError ? 'block' : 'none',
  display: (state) => state.hidden ? 'none' : 'block',
  opacity: (state) => state.opacity
}
```

- Returning `null`, `undefined`, `false`, or `''` removes the property.
- Numeric `0` is preserved as `'0'`.
- Style functions MUST be synchronous — returning a `Promise` throws `CORALITE-E303`.

### No conditional rendering ⚠ Framework invariant

There is **no conditional rendering** in Coralite. Every node in `<template>` is always present in the DOM. There is no `{{#if}}`, no `v-if`, no `*ngIf`, and no template-level conditional of any kind. See §5 for the full pattern set.

### No state duplication

Never mirror state into internal DOM properties or internal element `data-*` attributes. State is the single source of truth.

---

## 4. Host Attributes

Host attributes define how parent components pass parameters to child components (e.g. `<ui-profile size="md" name="Alice">` or `<conversation-row is-unread>`).

- **Schema Definition**: Host attributes are declared in the `attributes` block of `defineComponent`.
- **Reflection (`reflect: true`)**: When an attribute option includes `reflect: true`, Coralite automatically reflects changes in `state[attr]` back to the host element's HTML attribute:
  - Boolean attributes write attribute presence/absence (`is-unread` present when `true`, absent when `false`).
  - String attributes write attribute values (`size="md"`).
- **Public Interface Boundary**: External consumers and parent CSS inspect host attributes, not internal component child nodes.

**Allowed types**: `String`, `Number`, `Boolean`. `Array` and `Object` are not supported and throw `CORALITE-E101`. Use `server()` or the provide/consume protocol (§7) for structured data.

---

## 5. Conditional Visibility & Presence

⚠ Framework invariant — Coralite has no conditional rendering. Every template node is always present in the DOM. Visibility is controlled through attribute binding, host styles, slot builders, or native HTML elements.

### Decision table

| Case | Pattern | DOM cost |
|---|---|---|
| Toggle small block on state | `hidden="{{ noX }}"` + getter | Node always present |
| Toggle optional slot region | `slots: { name (nodes) { ... } }` returning `[]` when empty (§6) | Absent when empty |
| Style-only optional region | `::slotted([slot="x"])` (§6) | No wrapper at all |
| Reveal animation | `style` getter emitting a CSS custom property | CSS-driven |
| Hide entire component | `style: { display: (state) => ... }` on `:host` | Host present |
| Offscreen expensive content | `content-visibility: auto` | DOM present, render skipped |
| Disclosure / modal / popover | Native `<details>`, `<dialog>`, `popover` | Zero client JS |

### Getter-driven `hidden` — the default

```html
<template id="profile-form">
  <form ref="form">
    <slot></slot>
    <div class="error-section" role="alert" hidden="{{ noError }}">
      <p>{{ errorMessage }}</p>
    </div>
  </form>
</template>

<script type="module">
export default defineComponent({
  server() {
    return { errorMessage: '', hasError: false }
  },
  getters: {
    noError: ({ state }) => !state.hasError
  }
})
</script>
```

### Primitive distinctions

| Primitive | Removes from layout | Removes from a11y tree | Removes from tab order | Notes |
|---|---|---|---|---|
| `hidden` | Yes | Yes | Yes | Native boolean attribute |
| `aria-hidden="true"` | No | Yes | No | A11y-only |
| `inert` | No | Yes | Yes | Also blocks pointer events |
| `display: none` | Yes | Yes | Yes | What `hidden` maps to |
| `content-visibility: auto` | No | No | No | Render-skip only |

### Anti-patterns

- Do not assume `{{#if}}` or `v-if` works — it does not exist.
- Do not imperatively insert or remove DOM nodes inside `client()` as a visibility mechanism. This breaks SSR and hydration.
- Do not wrap optional slot content in a `hidden` div when the wrapper is only a styling hook — use `::slotted()` (§6).

---

## 6. Slots

Slots allow parent components to project light-DOM children into a child component's template. Coralite supports native `<slot>` elements and an optional `slots` block for content transformation at build/server time.

### Basic slot usage

```html
<template id="icon-button">
  <button ref="btn" type="button">
    <slot name="icon"></slot>
    <slot></slot>
  </button>
</template>
```

Consumer:

```html
<icon-button>
  <svg slot="icon" aria-hidden="true">…</svg>
  Save
</icon-button>
```

### Slot helpers in `client()`

The client context exposes a `slots` helper:

```js
client({ slots }) {
  slots.get('default')   // Array of projected nodes (filters comments/whitespace)
  slots.has('header')    // Boolean: does a named slot have content?
  slots.count('default') // Number of projected nodes
  slots.names            // Array of available slot names
}
```

### Slot builders — conditional wrappers ⚠ Framework invariant

When an optional region's wrapper element should only exist in the DOM if slot content is present, use a slot builder. The builder runs at build/server time (and optionally on the client) and receives projected nodes; return `[]` to suppress rendering entirely.

```js
slots: {
  icon (nodes) {
    if (!nodes.length) return []
    const span = document.createElement('span')
    span.className = 'icon'
    span.setAttribute('aria-hidden', 'true')
    for (const node of nodes) span.append(node)
    return [span]
  }
}
```

The builder context contains `{ state, root, refs, signal, observe, name, instanceId, isServer, isClient, slots }`. Returning `undefined` on the client preserves the SSR-rendered DOM without re-transforming.

### `::slotted()` — styling without wrappers

When a wrapper exists only for styling, skip it entirely. `::slotted(selector)` is auto-scoped by the Coralite compiler:

```html
<style>
  ::slotted([slot="icon"]) {
    display: inline-flex;
    align-items: center;
    margin-inline-end: 0.5rem;
  }
</style>
```

The compiler transforms this into `& > slot > [slot="icon"]` and `& > [slot="icon"]`.

### Slot transparency

Coralite injects `slot, c-token { display: contents; }` outside the component layer, so projected slotted children participate directly in parent Flexbox/Grid layouts without extra box wrapping.

---

## 7. Context Protocol — provide / consume

Coralite implements the **W3C Web Components Community Group Context Protocol** for tree-scoped dependency injection. This is distinct from plugin context — plugin context is app-scoped and delivered to `server()`/`client()`; provide/consume is tree-scoped and delivered via state.

### Defining a context key

Context keys live in their own module so both providers and consumers can import the same token:

```js
// contexts/theme.js
import { createContext } from 'coralite'

export const themeContext = createContext('theme')
```

Context keys are compared with strict equality (`===`). Two calls to `createContext` with the same primitive key return the same token. Use `Symbol.for('...')` for global identity, or a plain object for a unique token.

### Providing a value

An ancestor component supplies a value via the `provide` block:

```js
export default defineComponent({
  server() {
    return { currentTheme: 'dark' }
  },
  provide: {
    [themeContext]: ({ state }) => state.currentTheme
  }
})
```

### Consuming a value

A descendant requests a value via the `consume` block. Two forms:

```js
// Array shorthand — local name matches context key
consume: [themeContext]

// Property mapping — explicit local name with optional default
consume: {
  currentTheme: themeContext,
  userPreferences: { context: prefsContext, default: { theme: 'light' } }
}
```

The consumed value lands in `state` under the mapped property name and can be read by getters and templates exactly like any other state key.

### Subscription

Set `subscribe: true` on the consume entry to receive updates whenever the provider's value changes. Coralite retains consumer subscription callbacks using `WeakRef` with automatic pruning, and clears subscriptions on disconnect.

### When to use provide/consume

Use it for data that flows down a specific subtree — a theme set by a specific layout, a data store scoped to a section of the app, an app-shell configuration object. Do not use it for:

- Data that flows naturally through attributes (props)
- Values only one child needs
- Event-based communication (use `emit()` instead)
- App-wide services (use plugin context)

### Distinction from plugin context

| | Plugin context | provide/consume |
|---|---|---|
| **Scope** | Any component that installs the plugin | Only descendants of a provider element |
| **Setup** | Plugin registration in config | `provide` block on an ancestor component |
| **Access** | `server()`, `client()` contexts | `state` via `consume` block |
| **Lifecycle** | App lifetime | Provider element lifetime |
| **Purpose** | Framework-level services | Tree-scoped shared data |

---

## 8. Observation and Reactive Settlement

### `observe(key, callback)` ⚠ Framework invariant

`observe()` registers a listener for state changes. It is the mechanism for synchronizing reactive state with external, non-reactive systems — WebGL contexts, imperative DOM APIs, third-party chart libraries, native form integration, or `document.title`.

```js
client({ state, observe, signal }) {
  observe('count', (newValue, oldValue) => {
    // Sync with external system
    externalSystem.update(newValue)
  })
}
```

**Never mutate reactive state inside an `observe()` callback.** Doing so causes infinite reactive loops and triggers diagnostic `CORALITE-E302`. To mutate state, do so in an event handler. `observe()` is for external side effects only.

`observe()` returns a disposer function. It is automatically cleaned up on component disconnect — no need to wire `{ signal }` manually.

### `updateComplete` — reactive settlement

Coralite batches state mutations within a microtask. After mutating state, await `updateComplete` before querying the DOM:

```js
client({ state, updateComplete }) {
  state.count += 1
  await updateComplete
  // DOM is settled
}
```

`updateComplete` resolves to `true` when all current reactive updates have settled. It returns `Promise.resolve(true)` immediately when idle.

**Never rely on `setTimeout` or `requestAnimationFrame` for DOM synchronization.** Use `updateComplete`.

---

## 9. Form-Associated Components

Components that participate in native form submission (custom inputs, checkboxes, radio groups) opt in with `formAssociated: true`.

```js
export default defineComponent({
  formAssociated: true,
  attributes: {
    value: {
      type: String,
      default: '',
      validate: (val) => val.length >= 3 ? true : 'Minimum 3 characters required'
    }
  },
  client({ state, signal, refs, observe, setFormValue, setValidity, onFormReset }) {
    const input = refs('input')
    setFormValue(state.value)

    observe('value', (val) => {
      setFormValue(val)
      setValidity(
        val ? {} : { valueMissing: true },
        val ? '' : 'Required',
        input
      )
    })

    input.addEventListener('input', (e) => {
      state.value = e.target.value
    }, { signal })

    onFormReset(() => {
      state.value = ''
    })
  }
})
```

### Form lifecycle callbacks

| Callback | When it fires | Typical use |
|---|---|---|
| `setFormValue(value)` | Called by the component | Push the current value to the form |
| `setValidity(flags, message, anchor)` | Called by the component | Report constraint validity |
| `checkValidity()` | Called by the component | Run native validity check |
| `reportValidity()` | Called by the component | Show browser validation UI |
| `onFormReset(cb)` | Native form reset | Restore initial value |
| `onFormDisabled(cb)` | Form disables fieldset | Sync disabled state |
| `onFormRestore(cb)` | Form state restore | Restore saved value on back-navigation |

All form-related methods are only present on the client context when `formAssociated: true`.

---

## 10. Error Boundaries

The `onError` hook is an SSR-only error boundary. In production mode, if a component's render throws during SSR, Coralite calls `onError` and uses the returned markup as a fallback.

```js
onError({ error, state, element, page, root }) {
  return {
    template: '<div class="error-fallback"><p>{{ message }}</p></div>',
    state: { message: 'Component unavailable.' }
  }
}
```

The hook may return:

- A string of HTML, which replaces the component's template.
- An object `{ template, state }`, which replaces the template and seeds fallback state.

Components with `onError` are automatically marked `noHydration: true` when the fallback path triggers — no client JS is emitted for the failed render.

In `development` and `testing` modes, errors are re-thrown instead of handled, to preserve diagnostic visibility.

---

## 11. CSS State Hooks

All dynamic layout and state-driven styling MUST target reflected attributes on the **host element**.

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

## 12. Testing Attributes

To support automated end-to-end and component testing without coupling tests to implementation details:

- **Semantic Queries First**: Tests MUST prefer standard semantic queries (`getByRole`, `getByLabel`, `getByText`).
- **`data-testid` Fallback**: When no accessible role or label exists, use `data-testid="..."`.
- **Verbatim Authored**: `data-testid` values MUST be static, verbatim strings authored in the `<template>` block. Never bind dynamic state to `data-testid`.
- **`CORALITE_PRESERVE_TESTID` Policy**: Test IDs are preserved in production test builds when `CORALITE_PRESERVE_TESTID=true`.
- **Prohibition**: Internal `data-*` attributes (e.g., `data-room-id`, `data-state`, `data-unread`) are strictly forbidden as test hooks.

---

## 13. ARIA Attributes

Accessibility attributes (`aria-*`, `role="..."`) serve assistive technologies.

- **Semantic Purpose Only**: Set ARIA attributes for accessibility compliance (e.g. `aria-current="page"`, `aria-label="..."`, `role="alert"`).
- **Not Test Hooks / State Mirrors**: ARIA attributes must not be hijacked as test hooks or internal CSS state mirrors.
- **Reflected ARIA**: Use standard getter bindings (`aria-hidden="{{ hidden }}"`) or semantic HTML elements (`<button>`, `<nav>`, `<main>`).

---

## 14. Events

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

  The `signal` is aborted on component disconnect, which removes the listener automatically.

---

## 15. Internationalization

Every component rendering user-facing text MUST conform to the four-part i18n pattern documented in `packages/app/docs/plugins/i18n.md`:

1. **`server({ i18n })` block**: Fetch initial localized string keys synchronously using `i18n.strings([...])`.
2. **Template binding**: Bind dictionary keys directly in template mustache placeholders (`{{ auth_login_title }}`).
3. **`client({ state, i18n, signal })` subscription**: Subscribe to locale change events with `i18n.subscribeLocale(syncLocale, { signal })`.
4. **Locale Sync Guard**: Check `if (state.locale !== i18n.getLocale()) syncLocale(i18n.getLocale())` on client hydration to reconcile SSR and client locale state.

### Why the pattern bridges through state ⚠ Framework invariant

Plugin context is delivered only to `server()` and `client()`. It is **not** delivered to `getters`, `style`, or `slots`. This is why the i18n pattern resolves translations into state via `server()` and reads them from state in getters.

Writing `heading: ({ state, i18n }) => i18n.t('heading')` will produce `undefined` — `i18n` is not present on the getter context object.

The key list must be authored in **both** `server()` and `client()`. Module-scope constants cannot be shared across the boundary — the list in `client()` must be its own literal array.

---

## 16. Authoring Checklist

Every new or modified Coralite component MUST satisfy this checklist. Items marked ⚠ are framework invariants.

1. ☐ Export wrapped in `defineComponent(...)`. ⚠
2. ☐ State is seeded by `server()`'s return value. No top-level `state:` option. ⚠
3. ☐ Getters compute or format; no pass-through aliases. Templates read state keys directly when no computation is needed. ⚠
4. ☐ No expressions, function calls, or dot notation in template mustache tokens. ⚠
5. ☐ All state-driven CSS relies on `:host([attr])` with `reflect: true` attributes.
6. ☐ No internal `data-*` attributes exist in `<template>` except `data-testid` (or explicit `<!-- coralite-ignore-data-attributes -->` pragma for third-party integrations).
7. ☐ Tests rely on accessible role/label queries or verbatim `data-testid`.
8. ☐ User-facing strings use the four-part i18n pattern with `subscribeLocale` passing `{ signal }`.
9. ☐ No module-scope identifiers (imports, `const`s, helper functions) referenced inside `client()` or inside a getter that runs on the client. ⚠
10. ☐ No plugin context accessed from `getters`, `style`, or `slots`. ⚠
11. ☐ No environment-detection guards (`typeof window !== 'undefined'`) inside `client()` or `server()`. ⚠
12. ☐ `client()` function uses straight-line `async`/`await` without inner anonymous async IIFEs. ⚠
13. ☐ No state mutations inside `observe()` callbacks. ⚠
14. ☐ Getter context is destructured: `({ state }) => ...`, not `(state) => ...`. ⚠
15. ☐ `style` functions are synchronous and receive `state` directly. ⚠
16. ☐ Components with optional wrapper regions use slot builders, not `hidden` wrappers.
17. ☐ Components participating in native forms set `formAssociated: true` and call `setFormValue`/`setValidity`.
18. ☐ Run all three checks from `packages/app`:

    ```
    pnpm check-batches
    pnpm test:batch unit-smoke
    pnpm test:batch component-smoke
    ```

---

## 17. Failure Modes & Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Pattern |
|---|---|---|
| `data-unread="{{ isUnread }}"` on internal button | Duplicates state, creates dual source of truth, bloats DOM | Set `reflect: true` on `isUnread` attribute; style with `:host([is-unread])` |
| `element.dataset.storageReady = 'true'` in `client()` | Imperative DOM mutation bypassing component state | Update component state property (`state.storageReady = true`) with reflected attribute |
| `classList.toggle('active', isReady)` in `client()` | Bypasses CSS host selectors and component schema | Style using `:host([ready])` or `:host([active])` with `reflect: true` |
| `get myValue() { return this.state.myValue }` | Pass-through getter; redundant alias | Read `state.myValue` directly in the template |
| `{{#if condition}}` or `v-if` in template | Coralite has no conditional rendering — all nodes are always in the DOM | Use `hidden="{{ noX }}"` with a getter, a slot builder returning `[]`, or a native `<details>`/`<dialog>`/`popover` |
| `heading: ({ state, i18n }) => i18n.t(...)` in a getter | Plugin context is not delivered to getters; `i18n` is `undefined` | Bridge translations into state via `server()`; read from state in getters |
| `state: { count: 0 }` as a top-level option | Ignored by the runtime; state never initializes | Seed state via `server()`'s return value |
| Module-scope `const` or import referenced in `client()` | Module scope is stripped from the client bundle — `ReferenceError` at runtime | Author the value inline in `client()` or use dynamic `await import(...)` |
| `if (typeof window !== 'undefined')` inside `client()` | Dead code — `client()` only runs in the browser. Can silently break fallback logic | Remove the guard |
| Mutating `state.x` inside `observe('y', cb)` | Infinite reactive loop, `CORALITE-E302` diagnostic | Mutate state in event handlers only; reserve `observe()` for external systems |
| `i18n.subscribeLocale(cb)` without `{ signal }` | Memory leak on component disconnect | Pass `i18n.subscribeLocale(cb, { signal })` |
| `(async () => { await ... })()` inside `client()` | Unhandled promise rejections, breaks component teardown | Declare `client: async ({ ... }) => { await ... }` directly |
| Plugin resolver returns `{ icons: { get, list } }` for plugin named `icon` | Doubly-nested context; consumers must write `ctx.icon.icons.get` | Plugin name is the namespace — return `{ get, list }` directly |
| Top-level static import of client-only libraries | `ReferenceError` on the client — module scope is not included in the client bundle | Use dynamic `await import(...)` inside `client()` |
| Getter authored as `(state) => state.x` | Binds the context object to the parameter named `state`; `state.x` reads `context.x` which is `undefined` | Destructure: `({ state }) => state.x` |
| Async function in `style` block | Style functions must be synchronous; returning a Promise throws `CORALITE-E303` | Make the function synchronous |

---

## 18. Enforcement

Compliance with this guide is enforced automatically at build and test time:

- `packages/app/tests/unit/components-defineComponent.test.js`: Enforces the `defineComponent` wrapper on all component module exports (Rule 11).
- `packages/app/tests/unit/components-data-attrs.test.js`: Prohibits internal `data-*` attributes in templates except `data-testid` (Rules 5, 9).
- `packages/app/tests/unit/i18n.test.js` & `i18n-plugin.test.js`: Enforce the i18n contract, key resolution, and signal-based unsubscribing (Rules 19, 20).
- `pnpm check-batches`: Ensures all test files are registered in batch manifests.

Run all three checks from `packages/app` after any component change:

```bash
pnpm check-batches
pnpm test:batch unit-smoke
pnpm test:batch component-smoke
```

---

## 19. The 22 Canonical Rules

Rules marked ⚠ are Coralite framework invariants — violating them causes runtime errors or silent failures. Unmarked rules are `@atoll/app` project conventions enforced by code review.

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
- **Rule 14 — No conditional rendering.** Every template node is always in the DOM. Use `hidden="{{ noX }}"` with a getter, slot builders (§6), `::slotted()`, or native elements for conditional presentation. ⚠
- **Rule 15 — Plugin context is not available in getters, `style`, or `slots`.** Delivered to `server()` and `client()` only. Bridge through state. ⚠
- **Rule 16 — Plugin context keys are returned directly.** The plugin's `name` is the namespace. No wrapper object restating the plugin name. ⚠
- **Rule 17 — Module scope is server-only.** Top-level imports, `const`s, and helper functions are stripped from the client bundle. Any value needed on both sides must be authored on both sides, or dynamically imported inside `client()`. ⚠
- **Rule 18 — No environment guards inside single-environment blocks.** `typeof window !== 'undefined'` inside `client()` is dead code. `typeof process !== 'undefined'` inside `server()` is redundant. Only `getters`, `style`, and `slots` legitimately need environment checks. ⚠
- **Rule 19 — The four-part i18n pattern is required.** Every component with user-facing strings follows `packages/app/docs/plugins/i18n.md`.
- **Rule 20 — `subscribeLocale` (and all plugin subscription APIs) accept `{ signal }`.** The signal unsubscribes on disconnect. Plugin subscription APIs own their cleanup wiring — callers pass `{ signal }`, they do not call `addEventListener('abort', ...)` manually.
- **Rule 21 — `client()` may be `async`; do not wrap in an anonymous IIFE.** Top-level `await` is valid inside an async client block. Use this form for any async initialization. ⚠
- **Rule 22 — Never mutate state inside `observe()`.** `observe(key, cb)` is for synchronizing with external systems. State mutation inside the callback causes infinite reactive loops and triggers `CORALITE-E302`. Mutate state in event handlers only. ⚠

---

## Appendix A — Modal and Sheet Primitive

The application provides a single shared primitive for top-layer modals and bottom sheets: `<ui-sheet>`.

### Purpose

`<ui-sheet>` encapsulates a native HTML `<dialog>` element providing accessibility, top-layer rendering, native Escape handling, native focus trapping, and optional backdrop dismissal.

### Attribute Contract

| Attribute | Type | Default | Reflected | Description |
|---|---|---|---|---|
| `open` | Boolean | `false` | Yes | Controls dialog visibility and top-layer modal state. |
| `variant` | String | `'center'` | Yes | Layout mode: `'center'` (desktop/centered modal) or `'bottom'` (mobile bottom sheet). |
| `title` | String | `''` | No | Header title text. |
| `aria-label` | String | `''` | No | Accessible name fallback when title is omitted. |
| `show-close` | Boolean | `true` | No | Shows or hides the header close button (`✕`). |
| `close-label` | String | `'Close'` | No | Accessible label for the close button. |
| `dismissible` | Boolean | `true` | No | Enables Escape key and backdrop click dismissal. |

Note: host attributes are kebab-case in HTML. Inside component state, they alias to camelCase (`state.showClose`, `state.ariaLabel`).

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