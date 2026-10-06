# Icon Plugin & `<ui-icon>` Primitive

### Import pattern

The `client.context` uses a Phase 1 async dynamic import to load
`../lib/icons/index.js` into the browser bundle. This is required: static top-level
imports in the plugin file are not hoisted into the serialized client
bundle. See `docs/plugins/README.md` for the cross-cutting rule.

The Icon Plugin provides centralized, tree-shaken access to the Solar Icon set (`@solar-icons/static`) and exposes the `<ui-icon>` primitive custom element for scalable SVG icon rendering across application components and shell surfaces.

---

## 1. Overview

Icons in Atoll are driven by a strict canonical set from the Solar icon library. The `iconPlugin` registers the `ctx.icons` service across server and client component execution contexts. Components render icons declaratively using the `<ui-icon>` primitive.

---

## 2. The Canonical Set

Extensions and application components are restricted to names defined in `CANONICAL_ICONS`. Unrecognized names will throw an error or fail silently in safe rendering blocks.

Current canonical icons:
- `chat-round-line`
- `gallery`
- `document-text`
- `link`
- `phone`
- `settings`

---

## 3. The `ctx.icons` Contract

The icon plugin exposes the `icons` object under `ctx.icons` in both server and client contexts:

- `icons.get(name)`: Returns the normalized SVG string for a canonical icon name. Throws an `Error` if `name` is unknown or unmapped.
- `icons.list()`: Returns a frozen array of all canonical icon names.
- `icons.has(name)`: Returns `true` if `name` is in `CANONICAL_ICONS`, otherwise `false`.

---

## 4. The `<ui-icon>` Primitive

The `<ui-icon>` component renders an SVG icon host.

### Attributes
- `name` (`String`, default: `''`): The canonical icon name (e.g. `chat-round-line`).
- `size` (`String`, default: `'md'`): Semantic size token (`'sm'`, `'md'`, `'lg'`) or a raw CSS length (e.g., `'18px'`).
  - `'sm'` maps to `var(--icon-size-sm, 16px)`
  - `'md'` maps to `var(--icon-size-md, 20px)`
  - `'lg'` maps to `var(--icon-size-lg, 24px)`
- `color` (`String`, default: `'currentColor'`): CSS color value or token.
- `label` (`String`, default: `''`): Accessible label. When empty, `aria-hidden="true"` is applied to the wrapper element. When non-empty, `aria-label` is populated.

---

## 5. Adding an Icon

Adding a new icon to the canonical registry requires two steps:

1. Add the name string to `CANONICAL_ICONS` in `packages/app/src/lib/icons/index.js`.
2. Import the icon module from `@solar-icons/static` and add it to `SOLAR_MAP` in `packages/app/src/lib/icons/solar-map.js`.

---

## 6. The SSR Limitation

`<ui-icon>` renders SVG content on the client upon component hydration. During SSR, the primitive wrapper renders empty without throwing. This design ensures server rendering remains lightweight and avoids HTML AST string bloat, while client-side hydration populates icons immediately before application initial display.

---

## 7. Failure Modes & Safety

- **Unknown Name in `icons.get()`**: Throws a descriptive `Error`.
- **Unknown Name in `<ui-icon>`**: `<ui-icon>` catches the resolution error silently and clears its inner wrapper, rendering an empty block instead of crashing the UI.
- **Trusted Injection**: `refs('wrapper').innerHTML` is strictly used to inject pre-verified static SVG strings from `@solar-icons/static`. No user input ever reaches `innerHTML`.
