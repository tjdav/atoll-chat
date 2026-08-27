# Atoll Chat Color, Layout, & Gutter System Architecture

This document establishes the foundational modular design systems for Atoll Chat. It governs the visual rhythm, color foundations, screen margins, responsive column gutters, touch target dimensions, dynamic viewport safe areas, scoped component styling, and the pre-compiled theme matrix map across all supported platforms (Web, Capacitor iOS/Android). All design variables map seamlessly into native Bootstrap 5.3+ variables under a custom namespace prefix.

---

## 1. Modular Directory Structure

The design system core assets reside under `src/scss/` with component styling encapsulated inside scoped `<style>` blocks in Coralite `.html` components:

```text
src/scss/
├── theme/
│   ├── _variables-primitives.scss       # Brand base primitives, 20-step neutral scale, and $spacers
│   ├── _variables-colours.scss          # Raw solid hex colours, brand palette maps, and utility variables
│   ├── _variables-layout.scss           # Responsive breakpoints, container widths, and grid columns
│   ├── _variables-typography.scss       # Base font families, line-heights, and font-weight overrides
│   ├── _theme-layout-insets.scss        # Viewport safe area variables and composite dimension rules
│   ├── _mixins-states.scss              # Interactive component state functions/mixins
│   ├── _theme-semantic.scss             # Semantic CSS variables using native light-dark()
│   ├── _theme-typography.scss           # Typography settings and font scaling rules
│   ├── _theme-iconography.scss          # Global iconography utilities
│   ├── _typography-utilities.scss       # Layout/spacing classes for headers, labels, and text alignment
│   ├── _atoll-chat-theme-variables.scss # Chat view themes map configurations and color keys
│   ├── _atoll-chat-theme.scss           # Compilation & mapping of chat-specific styles (bubbles, headers, inputs)
│   └── _layout.scss                     # Consolidated dual-pane split, touch targets, and responsive overrides
├── _btn.scss                            # Global button utility modifiers (.btn-circle, .btn-ghost)
├── _display.scss                        # Display helper utilities
├── _markdown.scss                       # Prose formatting for dynamically rendered markdown
├── _variables.scss                      # Custom Bootstrap overrides ($enable-cssgrid, $prefix)
└── styles.scss                          # Main entry stylesheet orchestrating cascading imports
```

---

## 2. Strict Cascade Import Order

In `src/scss/styles.scss`, the import cascade is ordered intentionally so that Bootstrap consumes all primitive, layout, and override variables *prior* to generating utility maps and classes, and sets up semantic states and layouts in sequence:

```scss
// 1. Primitive Tokens & Custom Prefix Configuration ($prefix: "atoll-")
@import "theme/variables-primitives";
@import "theme/variables-colours";
@import "theme/atoll-chat-theme-variables";
@import "theme/variables-layout";
@import "theme/variables-typography";
@import "./variables";

// 2. Bootstrap Core Engine & Utilities Configuration
@import "bootstrap/scss/functions";
@import "bootstrap/scss/variables";
@import "bootstrap/scss/variables-dark";
@import "bootstrap/scss/maps";
@import "bootstrap/scss/mixins";
@import "bootstrap/scss/utilities";

// [Custom Utility Map Extensions]

// 3. Lean Bootstrap Primitives & Grid
@import "bootstrap/scss/root";
@import "bootstrap/scss/reboot";
@import "bootstrap/scss/type";
@import "bootstrap/scss/images";
@import "bootstrap/scss/containers";
@import "bootstrap/scss/grid";
@import "bootstrap/scss/forms";
@import "bootstrap/scss/buttons";
@import "bootstrap/scss/button-group";
@import "bootstrap/scss/dropdown";
@import "bootstrap/scss/card";
@import "bootstrap/scss/alert";
@import "bootstrap/scss/badge";
@import "bootstrap/scss/close";
@import "bootstrap/scss/modal";
@import "bootstrap/scss/spinners";
@import "bootstrap/scss/offcanvas";
@import "bootstrap/scss/placeholders";
@import "bootstrap/scss/transitions";
@import "bootstrap/scss/helpers";
@import "bootstrap/scss/utilities/api";

// 4. Global Semantic Token Matrix (light-dark() & Overlay Tokens)
@import "theme/mixins-states";
@import "theme/theme-semantic";
@import "theme/atoll-chat-theme";
@import "theme/theme-layout-insets";
@import "theme/theme-typography";
@import "theme/theme-iconography";
@import "theme/typography-utilities";
@import "theme/layout";

// 5. Global Content & Markdown Formatting
@import "display";
@import "markdown";
@import "btn";

// 6. Global Viewport Reset
html,
body {
  position: fixed;
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

---

## 3. Component Style Architecture & Scoped CSS

Atoll Chat enforces a zero-external-partial component style encapsulation model. Each Coralite `.html` component embeds its styles directly within a scoped `<style>` block.

### A. Scoped `<style>` in Coralite Components
Styles defined inside a component's `<style>` tag are scoped cleanly to that component instance. Host baseline layout rules are defined using `:host` and `:host([hidden])`:

```html
<style>
  :host {
    display: block;
    width: 100%;
  }

  :host([hidden]) {
    display: none !important;
  }

  .atoll-list-item {
    display: flex;
    align-items: center;
    padding: var(--atoll-list-item-padding-y, 8px) var(--atoll-list-item-padding-x, 16px);
    background-color: var(--atoll-bg-surface-primary);
  }
</style>
```

### B. Reactive Style Bindings (`defineComponent({ style })`)
For continuous, dynamic, or prop-calculated CSS custom properties, components declare a `style` dictionary in their Coralite component definition. These properties update reactively as component state changes:

```js
export default defineComponent({
  style: {
    '--atoll-icon-size': (state) => `${state.size || 24}px`,
    '--atoll-icon-primary-color': (state) => state.color || 'currentColor',
    '--atoll-profile-size': (state) => `${state.computedSize}px`
  }
})
```

---

## 4. Semantic Tokens & `light-dark()` Matrix

Atoll uses CSS native `light-dark(lightValue, darkValue)` functions declared on `:root` in `src/scss/theme/_theme-semantic.scss` to deliver theme switches without duplicated CSS rules.

### A. Core Semantic Variables
```scss
:root {
  color-scheme: light dark;

  /* Global Overlay Tokens */
  --atoll-backdrop-filter: blur(8px);
  --atoll-backdrop-bg: rgba(0, 0, 0, 0.45);

  /* Semantic Color Matrix */
  --atoll-body-bg: light-dark(#F5F5F5, #111111);
  --atoll-body-color: light-dark(#111111, #FFFFFF);
  --atoll-bg-surface-primary: light-dark(#FFFFFF, #161616);
  --atoll-bg-surface-secondary: light-dark(#F5F5F5, #1F1F1F);
  --atoll-bg-surface-tertiary: light-dark(#E8E8E8, #2A2A2A);
  --atoll-bg-surface-elevated: light-dark(#FFFFFF, #1F1F1F);
  
  --atoll-text-primary: light-dark(#111111, #FFFFFF);
  --atoll-text-secondary: light-dark(#555555, #B0B0B0);
  --atoll-text-muted: light-dark(#777777, #949494);

  --atoll-border-subtle: light-dark(#E8E8E8, rgba(255, 255, 255, 0.1));
  --atoll-border-strong: light-dark(#D4D4D4, rgba(255, 255, 255, 0.2));
}
```

### B. Theme Attribute Switching
Setting theme attributes on `<html>` or `body` toggles the engine's `color-scheme` preference:

```scss
[data-atoll-theme="light"],
[data-bs-theme="light"] {
  color-scheme: light;
}

[data-atoll-theme="dark"],
[data-bs-theme="dark"] {
  color-scheme: dark;
}
```

---

## 5. State Calculations with Native `color-mix()`

Interactive states (hover, focus, active rings) use CSS native `color-mix(in srgb, ...)` rather than hardcoded lightness adjustments, allowing real-time adaptation across theme modes:

```css
.atoll-input-control:focus {
  border-color: var(--atoll-primary, #06C755);
  box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--atoll-primary, #06C755) 20%, transparent);
}

.atoll-btn-danger:hover {
  background-color: color-mix(in srgb, var(--atoll-danger, #FF334B) 90%, #000000);
}
```

---

## 6. Global Overlay & Backdrop Tokens

Overlay components (`atoll-popup`, `atoll-toast`, `atoll-tooltip`, modal backdrops, and offcanvas drawers) consume standardized backdrop custom properties:

```css
--atoll-backdrop-filter: blur(8px);
--atoll-backdrop-bg: rgba(0, 0, 0, 0.45);
```

### Application in Overlays
```css
.atoll-popup-backdrop {
  background-color: var(--atoll-backdrop-bg, rgba(0, 0, 0, 0.45));
  backdrop-filter: var(--atoll-backdrop-filter, blur(8px));
  -webkit-backdrop-filter: var(--atoll-backdrop-filter, blur(8px));
}
```

---

## 7. Responsive Container Queries vs. Viewport Media Queries

Atoll Chat differentiates between outer application layout media queries and inner component container queries:

* **Viewport Media Queries (`@media`):** Used in `src/scss/theme/_layout.scss` for master dual-pane split-screen layouts, drawer breakpoints (`< 768px`), and mobile navigation bar visibility (`< 576px`).
* **Container Queries (`@container`):** Used inside list items (`atoll-list-item`, `chat-list-item`) to adapt font size, padding, and timestamp displays based on the width of their parent container (e.g. narrow sidebar vs wide detail host):

```css
:host {
  display: block;
  container-type: inline-size;
}

@container (max-width: 280px) {
  .atoll-list-item {
    padding-left: 8px;
    padding-right: 8px;
  }
  .atoll-list-item-timestamp {
    display: none;
  }
}
```

---

## 8. Namespace Translation (`$prefix`)

The default Bootstrap prefix variable `$prefix` is configured centrally to `"atoll-"` in `_variables-primitives.scss`:

```scss
$prefix: "atoll-";
```

Defining this renames all CSS custom properties emitted globally by Bootstrap. For example, standard variables such as `--bs-body-bg` and `--bs-primary` are translated globally to:
- `--atoll-body-bg`
- `--atoll-primary`

---

## 9. Spatial Grid System (4px / 8px Base Grid)

Atoll Chat enforces a dual-density spatial grid system:

* **Micro-Grid (4px increments):** Internal component padding, inline icon-to-text spacing, status badge offsets, and chat bubble metadata.
* **Macro-Grid (8px increments):** Layout margins, card container padding, section spacing, and vertical list rhythm.

### Bootstrap `$spacers` Map Override

```scss
$spacer: 1rem; // 16px base

$spacers: (
  0: 0,
  1: 0.25rem, //  4px (Micro Offset)
  2: 0.5rem,  //  8px (Base Spatial Unit)
  3: 0.75rem, // 12px (Micro Gap)
  4: 1rem,    // 16px (Standard Layout Margin)
  5: 1.5rem,  // 24px (Container Padding)
  6: 2rem,    // 32px (Section Gap)
  7: 3rem,    // 48px (Control Bar Height)
  8: 4rem     // 64px (Desktop Header Height)
);
```

---

## 10. Viewport Safe Areas (Capacitor Mobile & Notch Handling)

Atoll Chat integrates CSS `env(safe-area-inset-*)` variables directly into layout calculation rules in `src/scss/theme/_theme-layout-insets.scss`:

```scss
:root {
  --atoll-safe-area-top: env(safe-area-inset-top, 0px);
  --atoll-safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --atoll-safe-area-left: env(safe-area-inset-left, 0px);
  --atoll-safe-area-right: env(safe-area-inset-right, 0px);

  --atoll-header-height: 56px;
  --atoll-total-header-height: calc(var(--atoll-header-height) + var(--atoll-safe-area-top));
  --atoll-total-bottom-bar-height: calc(56px + var(--atoll-safe-area-bottom));
}
```
