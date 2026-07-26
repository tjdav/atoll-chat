# Atoll Chat Color System & Theme Architecture

This document establishes the foundational modular color system for Atoll Chat. Built on the structural principles of high-scale messenger design systems, all variables, CSS custom properties, and theme attributes have been re-engineered to map seamlessly into native Bootstrap 5.3+ variables under a custom namespace prefix.

---

## 1. Modular Directory Structure

The theme and color system reside in a dedicated, modular directory under `src/scss/theme/` to ensure modularity, separation of concerns, and clean maintenance:

```text
src/scss/
├── theme/
│   ├── _variables-primitives.scss  # Brand base primitives & 20-step neutral scale
│   ├── _variables-rainbow.scss     # Rainbow scale map & core Bootstrap overrides
│   ├── _mixins-states.scss         # Interactive component state functions/mixins
│   └── _theme-semantic.scss        # Semantic CSS variables for light/dark modes
└── styles.scss                     # Main entry stylesheet orchestrating cascading imports
```

---

## 2. Strict Cascade Import Order

In `src/scss/styles.scss`, the import cascade is ordered intentionally so that Bootstrap consumes all primitive overrides and the custom prefix configuration *prior* to generating utility maps and classes:

```scss
// 1. Primitive Tokens & Custom Prefix Configuration
@import "theme/variables-primitives";

// 2. Rainbow & Bootstrap Variable Overrides ($primary, $theme-colors, etc.)
@import "theme/variables-rainbow";

// 3. Main Project Custom Layout variables
@import "./variables";

// 4. Bootstrap Core Functions, Mixins & Variables
@import "bootstrap-icons/font/bootstrap-icons.scss";
@import "bootstrap/scss/functions";
@import "bootstrap/scss/variables";
@import "bootstrap/scss/variables-dark";
@import "bootstrap/scss/maps";
@import "bootstrap/scss/mixins";
@import "bootstrap/scss/utilities";

// [Project Utility Map-Merges]

// 5. Native Bootstrap CSS Generation Imports
@import "bootstrap/scss/root";
@import "bootstrap/scss/reboot";
// ... Other Bootstrap component modules ...

// 6. Interactive Component State Mixins & Functions
@import "theme/mixins-states";

// 7. Light/Dark Semantic Token Matrix
@import "theme/theme-semantic";

// 8. Application Layouts & Component styles
@import "display";
@import "layout";
// ... Other component stylesheet partials ...
```

---

## 3. Namespace Translation (`$prefix`)

The default Bootstrap prefix variable `$prefix` is configured centrally to `"atoll-"` in `_variables-primitives.scss`:

```scss
$prefix: "atoll-";
```

Defining this renames all CSS custom properties emitted globally by Bootstrap. For example, standard variables such as `--bs-body-bg` and `--bs-primary` are translated globally to:
- `--atoll-body-bg`
- `--atoll-primary`

All component-level SCSS files dynamically resolve these variables using the dynamically evaluated SASS syntax `var(--#{$prefix}primary)` rather than hardcoding references, ensuring total layout consistency with zero manual component updates.

---

## 4. Color Scale Specifications

### A. Primitive Base Palette
Immutably defines raw, solid hex colors representing brand accents and a custom **20-Step Neutral Scale** ($grays) mapping directly into Bootstrap:

* **iOS / OLED Primary Accent (`$atoll-green-500`):** `#06C755`
* **Web / sRGB Standard Accent (`$atoll-green-400`):** `#4CC764`
* **Deep Brand Accent (`$atoll-green-600`):** `#00A843`

The **20-step Neutral Scale (`$grays`)**:
```scss
$grays: (
  "000": #FFFFFF,
  "050": #FAFAFA,
  "100": #F5F5F5,
  "150": #EFEFEF,
  "200": #E8E8E8,
  "250": #DFDFDF,
  "300": #D4D4D4,
  "400": #B0B0B0,
  "500": #949494,
  "600": #777777,
  "700": #555555,
  "750": #3A3A3A,
  "800": #2A2A2A,
  "830": #222222,
  "850": #1F1F1F,
  "870": #161616,
  "900": #111111,
  "950": #0A0A0A,
  "1000": #000000
);
```

### B. Categorical Rainbow Palette
Provides contrast-rich distinction for tags, statuses, badges, and user-group indicators mapping to `$theme-colors`:

| Category Token | Hex Code | Utility Classes | Core Application |
| --- | --- | --- | --- |
| `rainbow-red` | `#FF334B` | `.text-danger`, `.bg-danger` | Destructive triggers, error states, active recording indicators |
| `rainbow-orange` | `#FF8A00` | `.text-warning`, `.bg-warning` | Warning banners, away presence status |
| `rainbow-yellow` | `#FFC700` | `.text-yellow`, `.bg-yellow` | Message pin indicators, starred highlights |
| `rainbow-green` | `#06C755` | `.text-success`, `.bg-success` | Active online presence, secure badges |
| `rainbow-blue` | `#4270ED` | `.text-info`, `.bg-info` | Web hyperlinks, active speaker highlighting |
| `rainbow-purple` | `#9B51E0` | `.text-purple`, `.bg-purple` | Custom roles, bot tags, special room identifiers |

---

## 5. Semantic Tokens (Theme Engine)

Atoll bridges abstract primitive values to user-facing layouts using semantic variables, which transition dynamically depending on the current theme mode (`[data-bs-theme="light"]` and `[data-bs-theme="dark"]`).

Semantic variables observe a structured naming framework:
`--atoll-[category]-[property]-[priority]`

Key mappings include:
- **Backgrounds:** `--atoll-bg-body`, `--atoll-bg-surface-primary` (primary pages/cards), `--atoll-bg-surface-secondary` (inner panes/sidebars), `--atoll-bg-surface-tertiary` (inputs, highlights), and `--atoll-bg-surface-elevated` (tooltips, overlays, dialog panels).
- **Typography:** `--atoll-text-primary` (regular bold/readable body text), `--atoll-text-secondary`, `--atoll-text-tertiary`, `--atoll-text-quaternary`, and `--atoll-text-on-brand`.
- **Borders & Dividers:** `--atoll-border-subtle`, `--atoll-border-strong`, and `--atoll-border-interactive`.
- **Identity Accent:** `--atoll-brand-primary`, `--atoll-brand-primary-rgb`, `--atoll-brand-secondary`, and `--atoll-brand-subtle-bg`.

---

## 6. Mathematical State Engine

Interactive elements calculate their hovered, active, or focused values programmatically based on lightness thresholds ($V$) using an HSV mathematical framework.

The state SASS function is configured in `_mixins-states.scss`:
```scss
@function calculate-atoll-state($color, $state-type: "hover") {
  $lightness: color.get-lightness($color);
  
  @if $state-type == "hover" {
    @if $lightness > 85% {
      @return color.adjust($color, $lightness: -6%);
    } @else if $lightness < 20% {
      @return color.adjust($color, $lightness: +12%);
    } @else {
      @return color.adjust($color, $lightness: -8%);
    }
  } @else if $state-type == "active" {
    @if $lightness > 85% {
      @return color.adjust($color, $lightness: -12%);
    } @else if $lightness < 20% {
      @return color.adjust($color, $lightness: +20%);
    } @else {
      @return color.adjust($color, $lightness: -15%);
    }
  }
  @return $color;
}
```

Components requiring standard, accessible buttons make use of `.btn-atoll-primary` styling utilizing `color-mix` transformations to resolve dynamic state shifts.
