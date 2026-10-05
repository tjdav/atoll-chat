# Messenger Shell & Three-Panel Layout Architecture

## 1. Overview

The messenger shell (`<messenger-shell>`) is the root layout container for the Atoll web application. It owns the spatial arrangement of the primary navigation rail, conversation/feature list panel, active detail panel, and mobile bottom navigation bar.

The shell acts as a passive, empty structural frame. It does not contain application business logic or extension implementations directly; instead, it provides clean host containers (`<rail-host>`, `<surface-host>`, and `.shell__bottom-nav`) that are populated dynamically by the extension system (`@atoll/extend`).

## 2. Layout Breakpoints

The shell enforces a responsive three-panel grid system adapting across three viewport tiers using CSS Grid:

### Mobile (<768px)
- **Grid Template:** `grid-template-columns: 1fr; grid-template-rows: 1fr var(--mobile-nav-height);`
- **Behavior:** Single-column detail view with an empty bottom navigation bar (`<nav class="shell__bottom-nav">`). The list panel (`.surface__list`) and rail column (`.shell__rail`) are hidden by default.

### Tablet (768px–1023px)
- **Grid Template:** `grid-template-columns: 1fr; grid-template-rows: 1fr var(--mobile-nav-height);` on `.shell`, with `.surface` set to `grid-template-columns: minmax(var(--list-panel-min), var(--list-panel-max)) 1fr;`
- **Behavior:** List panel (`.surface__list`) and detail panel (`.surface__detail`) render side by side. Bottom navigation remains visible at the base of the viewport. The primary rail column remains hidden.

### Desktop (≥1024px)
- **Grid Template:** `grid-template-columns: var(--rail-width) 1fr; grid-template-rows: 1fr;` on `.shell`, with `.surface` set to `grid-template-columns: minmax(var(--list-panel-min), var(--list-panel-max)) 1fr;`
- **Behavior:** Full three-panel layout (`64px` navigation rail | `320px–400px` list panel | `flex` detail panel). The bottom navigation bar is hidden (`display: none`).

## 3. Component Structure

The shell is composed of three custom components:

- **`<messenger-shell>`** (`packages/app/src/components/shell/messenger-shell.html`): The root grid wrapper (`.shell`). Owns the high-level grid CSS, responsive media queries, safe-area padding, bottom navigation element (`.shell__bottom-nav`), and `app:ready` visibility gating.
- **`<rail-host>`** (`packages/app/src/components/shell/rail-host.html`): The navigation rail column wrapper. Uses `display: block` so it participates directly in the shell grid.
- **`<surface-host>`** (`packages/app/src/components/shell/surface-host.html`): The list and detail surfaces wrapper. Uses `display: block` and contains `.surface__list` (`<section>`) and `.surface__detail` (`<main>`).

## 4. Extension Integration Points

The shell provides four empty containers designed for insertion by the extension system:

1. **`rail-host`'s `.rail` (`[data-testid="rail"]`)**
   - **Target:** Primary navigation icons on desktop.
   - **Population:** Extension tasks query or listen for active registered extensions and mount icon items into `.rail` sorted by `rail.order`.
2. **`surface-host`'s `.surface__list` (`[data-testid="list-panel"]`)**
   - **Target:** Conversation list, search results, or feature navigation views.
   - **Population:** `surface-host` reads `ctx.extensions` and `ctx.router`. On mount and on `router.subscribe`, it resolves the active rail's extension and mounts its `list.component` into `<section class="surface__list">`.
3. **`surface-host`'s `.surface__detail` (`[data-testid="detail-panel"]`)**
   - **Target:** Active conversation timeline, thread detail, call window, or settings view.
   - **Population:** `surface-host` resolves the extension owning the active detail route via `extensions.ownerOfRoute(detailRoute)` and mounts its `detail.component` into `<main class="surface__detail">`.
   - **Reconciliation:** The mounted element in list or detail panel is replaced only when the resolved component tag changes. Navigating between routes that share the same component tag (such as `extension-placeholder`) does not unmount or recreate the DOM node.
   - **Canonicalization:** On initial render, if no `rail` query parameter is set in the URL, `surface-host` calls `router.navigate({ rail: fallback.id }, { replace: true })` to rewrite the URL to the first rail-bearing extension without polluting browser back history.
4. **`messenger-shell`'s `.shell__bottom-nav` (`[data-testid="bottom-nav"]`)**
   - **Target:** Mobile and tablet quick-access slots (capped at 5 primary slots).
   - **Population:** Extension tasks mount bottom navigation buttons into `<nav class="shell__bottom-nav">` on mobile/tablet screens.

## 5. The `app:ready` Gate

The shell starts hidden (`ready: false`, `style.display = 'none'`) during application bootstrap to prevent layout shifts or unpopulated panel flashes.

When session validation completes in `<messenger-boot>`, the boot component emits an `app:ready` custom event on `window` (via Coralite's bubbling event mechanism). `<messenger-shell>` listens for `app:ready` on `window` with `{ signal }` cleanup and updates `state.ready = true`, switching its display style to `block`.

Future components or extension loaders that populate shell containers MUST defer DOM insertion until after `app:ready` has fired or check `document.querySelector('messenger-shell').hasAttribute('ready')`.

## 6. Safe Areas

The shell applies safe area inset tokens directly to `.shell`:

```css
padding-top: var(--safe-top);
padding-right: var(--safe-right);
padding-bottom: var(--safe-bottom);
padding-left: var(--safe-left);
box-sizing: border-box;
```

In standard browsers, these resolve to `0px`. On mobile web, Capacitor, or Tauri platforms, they automatically adapt to physical screen notches, rounded corners, and home indicators. Hosted panels and extension views inside the shell assume safe areas are already handled at the outer grid boundary and MUST NOT re-apply outer safe area padding.

## 7. Accessibility Landmarks

The shell uses standard HTML accessibility landmarks and ARIA labels:

- **Primary Navigation Rail:** `<rail-host aria-label="{{ app_shell_rail_label }}">` with `aria-label` resolved from `app_shell_rail_label` ("Primary navigation").
- **Bottom Navigation Bar:** `<nav class="shell__bottom-nav" aria-label="{{ app_shell_bottom_nav_label }}">` with `aria-label` resolved from `app_shell_bottom_nav_label` ("Primary navigation").
- **List Panel:** `<section class="surface__list" aria-label="{{ app_shell_list_label }}">` with `aria-label` resolved from `app_shell_list_label` ("Conversations").
- **Detail Panel:** `<main class="surface__detail" aria-label="{{ app_shell_detail_label }}">` with `aria-label` resolved from `app_shell_detail_label` ("Active view").
