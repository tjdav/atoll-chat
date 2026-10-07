# Component Authoring Guide

This document establishes the canonical rules, architecture, and authoring guide for Coralite components in `@atoll/app`. Every component author must read and satisfy these rules before creating or modifying components.

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
  server({ i18n }) { ... },
  client({ state, refs, emit, signal, i18n }) { ... }
})
</script>
```

### Block Responsibilities:
- **`<template>` block**: Holds static HTML markup, template bindings (`{{ getter }}`), event listeners, and optional `ref="..."` attributes or `data-testid="..."` test hooks.
- **`<style>` block**: Contains CSS scoped to the component. Rules target `:host`, `:host([attr])`, or internal class names.
- **`<script type="module">` block**: Defines the component interface using `defineComponent(...)`.
  - **`server()`**: Runs during SSR to resolve initial data (e.g. initial i18n string dictionaries).
  - **`client()`**: Runs on client hydration to attach reactive subscriptions, DOM listeners, and side effects.

---

## 3. State and the Template

**State is the single source of truth.** All reactive dynamic data lives in the component's `state` (initialized via `attributes` or modified in `client()`).

- **Getters compute data**: Computations and conditional formatting belong in `getters`. Getters compute derived values synchronously from `state`.
- **Templates read getters**: The template references getters using flat mustache identifiers (`{{ myGetter }}`). Templates MUST NOT perform expressions or complex lookups.
- **No state duplication**: Never mirror state into internal DOM properties or internal element `data-*` attributes.

---

## 4. Host Attributes are the Public Interface

Host attributes define how parent components pass parameters to child components (e.g. `<ui-profile size="md" name="Alice">` or `<conversation-row is-unread>`).

- **Schema Definition**: Host attributes are declared in the `attributes` block of `defineComponent`.
- **Reflection (`reflect: true`)**: When an attribute option includes `reflect: true`, Coralite automatically reflects changes in `state[attr]` back to the host element's HTML attribute:
  - Boolean attributes write attribute presence/absence (`is-unread` present when `true`, absent when `false`).
  - String attributes write attribute values (`size="md"`).
- **Public Interface Boundary**: External consumers and parent CSS inspect host attributes, not internal component child nodes.

---

## 5. CSS State Hooks

All dynamic layout and state-driven styling MUST target reflected attributes on the **host element**.

### Preferred CSS Patterns:
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

### Prohibited Patterns:
- Do NOT add internal `data-*` attributes to internal markup nodes for CSS targeting (e.g., `.row[data-unread="true"]` is forbidden).
- Do NOT imperatively add/remove CSS classes via `classList.add(...)` or `classList.toggle(...)` in `client()`.

---

## 6. Testing Attributes

To support automated end-to-end and component testing without coupling tests to implementation details:

- **Semantic Queries First**: Tests MUST prefer standard semantic queries (`getByRole`, `getByLabel`, `getByText`).
- **`data-testid` Fallback**: When no accessible role or label exists, use `data-testid="..."`.
- ** Verbatim Authored**: `data-testid` values MUST be static, verbatim strings authored in the `<template>` block. Never bind dynamic state to `data-testid`.
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

- **`emit(eventName, detail)`**: Provided in the `client()` context parameter.
- **Standard Event Names**:
  - Auth events: `auth:view-change`, `auth:login:submit`, `auth:register:submit`, `auth:recover:submit`.
  - App events: `app:ready`, `app:error`.
  - Component events: `select`, `change`.
- **DOM Event Bubbling**: Emitted events bubble up the Light DOM tree, allowing ancestor containers to handle them.

---

## 9. Internationalization (i18n)

Every component rendering user-facing text MUST conform to the four-part i18n pattern documented in `packages/app/docs/plugins/i18n.md`:

1. **`server({ i18n })` block**: Fetch initial localized string keys synchronously using `i18n.strings([...])`.
2. **Template binding**: Bind dictionary keys directly in template mustache placeholders (`{{ auth_login_title }}`).
3. **`client({ state, i18n, signal })` subscription**: Subscribe to locale change events with `i18n.subscribeLocale(syncLocale, { signal })`.
4. **Locale Sync Guard**: Check `if (state.locale !== i18n.getLocale()) syncLocale(i18n.getLocale())` on client hydration to reconcile SSR and client locale state.

---

## 10. The Authoring Checklist

Every new or modified Coralite component MUST satisfy this checklist:

1. [ ] Export wrapped in `defineComponent(...)`.
2. [ ] State is the single source of truth; getters derive display values flatly.
3. [ ] All state-driven CSS relies on `:host([attr])` with `reflect: true` attributes.
4. [ ] No internal `data-*` attributes exist in `<template>` except `data-testid` (or explicit `<!-- coralite-ignore-data-attributes -->` pragma for third-party integrations).
5. [ ] Tests rely on accessible role/label queries or verbatim `data-testid`.
6. [ ] User-facing strings use the four-part i18n pattern with `subscribeLocale` passing `{ signal }`.
7. [ ] No pass-through getters (getters must compute or format).
8. [ ] `client()` function uses straight-line `async`/`await` without inner anonymous async IIFEs.
9. [ ] No module-scope imports inside `client()` body (use dynamic `import()` inside `client()` or import at file module top level).
10. [ ] `pnpm test:batch unit-smoke` (including `components-data-attrs.test.js`) passes cleanly.

---

## 11. Failure Modes & Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Pattern |
| :--- | :--- | :--- |
| `data-unread="{{ isUnread }}"` on internal button | Duplicates state, creates dual source of truth, bloats DOM | Set `reflect: true` on `isUnread` attribute; style with `:host([is-unread])` |
| `element.dataset.storageReady = 'true'` in `client()` | Imperative DOM mutation bypassing component state | Update component state property (`state.storageReady = true`) with reflected attribute |
| `classList.toggle('active', isReady)` in `client()` | Bypasses CSS host selectors and component schema | Style using `:host([ready])` or `:host([active])` with `reflect: true` |
| `get myValue() { return this.state.myValue }` | Pass-through getter; redundant alias | Read `state.myValue` directly or use attribute default |
| `(async () => { await ... })()` inside `client()` | Unhandled promise rejections, breaks component teardown | Declare `client: async ({ ... }) => { await ... }` directly |
| `i18n.subscribeLocale(cb)` without `{ signal }` | Memory leak on component disconnect | Pass `i18n.subscribeLocale(cb, { signal })` |
| Top-level static import of client-only libraries | SSR build failure or bundle hoisting error | Use dynamic `await import(...)` inside `client()` |

---

## 12. Enforcement

Compliance with this guide is enforced automatically at build and test time:

- **`packages/app/tests/unit/components-defineComponent.test.js`**: Enforces Rule 10 (`defineComponent` wrapper on all component module exports).
- **`packages/app/tests/unit/components-data-attrs.test.js`**: Enforces Rule 4 & Rule 8 (prohibits internal `data-*` attributes in templates except `data-testid`).
- **`packages/app/tests/unit/i18n.test.js` & `i18n-plugin.test.js`**: Enforces Rule 11 & Rule 14 (i18n contract, key resolution, and signal-based unsubscribing).
- **`pnpm check-batches`**: Ensures all test files are properly registered in batch manifests.

---

## The 16 Canonical Rules

- **Rule 1 — State is the source of truth.** Component state lives in `state`. The template reads it through getters. The `client()` block reads and writes it. No duplication elsewhere.
- **Rule 2 — CSS state hooks go on the host.** When a state value must drive CSS, reflect it as a host attribute with `reflect: true`. The component's scoped CSS reads `:host([attr])` or `:host([attr="value"])`. The internal element does not carry a `data-*` attribute.
- **Rule 3 — Host attributes are the public interface.** A consumer sets host attributes (`<conversation-row is-unread>`). The component's state reflects them. Reflected attributes write back to the host for CSS and tests.
- **Rule 4 — `data-testid` is the only sanctioned `data-*` in a template.** Static, authored verbatim, never dynamic. Queried by Playwright's `getByTestId`. Preserved across builds when `CORALITE_PRESERVE_TESTID=true`.
- **Rule 5 — Prefer semantic queries over `data-testid`.** `getByRole` with an accessible name, `getByLabel`, `getByText`. Use `data-testid` only when no semantic query is available.
- **Rule 6 — `aria-*` attributes are semantic.** Set them for assistive technology. They are not test hooks and not state mirrors. If an element has a role and a state (e.g., `aria-current`), use the ARIA attribute, not a `data-*` twin.
- **Rule 7 — No dead attributes.** If an attribute is not consumed by CSS, a test, or an assistive technology, remove it.
- **Rule 8 — No imperative state-mirroring.** Do not write to a `data-*` attribute from `client()` to expose state. Reflect the state on the host instead.
- **Rule 9 — No imperative class toggling for state.** Classes are static in the template. State-driven layout uses host reflected attributes with `:host([...])` selectors.
- **Rule 10 — `defineComponent` is required.** Every component wraps its export. The enforcement test is `packages/app/tests/unit/components-defineComponent.test.js`.
- **Rule 11 — The four-part i18n pattern is required.** Every component with user-facing strings follows `packages/app/docs/plugins/i18n.md`.
- **Rule 12 — No pass-through getters.** A getter computes; it does not alias a state key.
- **Rule 13 — `client()` may be `async`; do not wrap in an anonymous IIFE.** Top-level `await` is valid inside an `async` client block.
- **Rule 14 — `subscribeLocale` requires `{ signal }`.** The signal unsubscribes on disconnect.
- **Rule 15 — No module-scope imports or helpers in `client()`.** Use dynamic `import()` inside `client()` or move helpers to the `server()` block when they run at SSR time.
- **Rule 16 — Plugin context keys are returned directly.** The plugin's `name` is the namespace. No wrapper object restating the plugin name.
