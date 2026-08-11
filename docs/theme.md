# Atoll Chat Color, Layout, & Gutter System Architecture

This document establishes the foundational modular design systems for Atoll Chat. It governs the visual rhythm, color foundations, screen margins, responsive column gutters, touch target dimensions, dynamic viewport safe areas, and the pre-compiled theme matrix map across all supported platforms (Web, Capacitor iOS/Android). All design variables map seamlessly into native Bootstrap 5.3+ variables under a custom namespace prefix.

---

## 1. Modular Directory Structure

The design system assets reside under `src/scss/theme/` to ensure modularity, separation of concerns, and clean maintenance:

```text
src/scss/
├── theme/
│   ├── _variables-primitives.scss     # Brand base primitives, 20-step neutral scale, and $spacers
│   ├── _variables-colours.scss        # Raw solid hex colours, brand palette maps, and utility variables
│   ├── _variables-layout.scss         # Responsive breakpoints, container widths, and grid columns
│   ├── _theme-layout-insets.scss      # Viewport safe area variables and composite dimension rules
│   ├── _mixins-states.scss            # Interactive component state functions/mixins
│   ├── _theme-semantic.scss           # Semantic CSS variables for light/dark modes
│   ├── _theme-typography.scss         # Typography settings and font scaling rules
│   ├── _typography-utilities.scss     # Layout/spacing classes for headers, labels, and text alignment
│   ├── _variables-typography.scss     # Base font families, line-heights, and font-weight overrides
│   ├── _atoll-chat-theme-variables.scss # Chat view themes map configurations and color keys
│   ├── _atoll-chat-theme.scss         # Compilation & mapping of chat-specific styles (bubbles, headers, inputs)
│   └── _layout.scss                   # Consolidated dual-pane split, touch targets, and responsive overrides
└── styles.scss                        # Main entry stylesheet orchestrating cascading imports
```

---

## 2. Strict Cascade Import Order

In `src/scss/styles.scss`, the import cascade is ordered intentionally so that Bootstrap consumes all primitive, layout, and override variables *prior* to generating utility maps and classes, and sets up semantic states and layouts in sequence:

```scss
// 1. Primitive Tokens & Custom Prefix Configuration
@import "theme/variables-primitives";

// 2. Colours & Bootstrap Variable Overrides ($primary, $theme-colors, etc.)
@import "theme/variables-colours";

// 3. Responsive Breakpoints & Layout overrides
@import "theme/variables-layout";

// 4. Main Project Custom overrides
@import "./variables";

// 5. Bootstrap Core Functions, Mixins & Variables
@import "bootstrap-icons/font/bootstrap-icons.scss";
@import "bootstrap/scss/functions";
@import "bootstrap/scss/variables";
@import "bootstrap/scss/variables-dark";
@import "bootstrap/scss/maps";
@import "bootstrap/scss/mixins";
@import "bootstrap/scss/utilities";

// [Project Utility Map-Merges]

// 6. Native Bootstrap CSS Generation Imports
@import "bootstrap/scss/root";
@import "bootstrap/scss/reboot";
// ... Other Bootstrap component modules ...

// 7. Interactive Component State Mixins & Functions
@import "theme/mixins-states";

// 8. Light/Dark Semantic Token Matrix
@import "theme/theme-semantic";

// 9. Viewport Safe Area Layout Insets
@import "theme/theme-layout-insets";

// 10. Unified & Responsive Layout
@import "theme/layout";

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
Provides contrast-rich distinction for tags, statuses, badges, and user-group indicators mapping to `$theme-colors` via `_variables-colours.scss`:

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

Atoll bridges abstract primitive values to user-facing layouts using semantic variables, which transition dynamically depending on the current theme mode (`[data-atoll-theme="light"]` and `[data-atoll-theme="dark"]`).

Semantic variables observe a structured naming framework:
`--atoll-[category]-[property]-[priority]`

Key mappings include:
- **Backgrounds:** `--atoll-bg-body`, `--atoll-bg-surface-primary` (primary pages/cards), `--atoll-bg-surface-secondary` (inner panes/sidebars), `--atoll-bg-surface-tertiary` (inputs, highlights), and `--atoll-bg-surface-elevated` (tooltips, overlays, dialog panels).
- **Typography:** `--atoll-text-primary` (regular bold/readable body text), `--atoll-text-secondary`, `--atoll-text-tertiary`, `--atoll-text-quaternary`, and `--atoll-text-on-brand`.
- **Borders & Dividers:** `--atoll-border-subtle`, `--atoll-border-strong`, and `--atoll-border-interactive`.
- **Identity Accent:** `--atoll-brand-primary`, `--atoll-brand-primary-rgb`, `--atoll-brand-secondary`, and `--atoll-brand-subtle-bg`.

---

## 6. Pre-compiled Chat View Themes Map (`$atoll-chat-themes`)

Atoll Chat includes standard predefined visual themes mapping custom variables directly onto `.chat-view` hosts. This configures bubble layouts, headers, buttons, date badges, and inputs dynamically:

1. **Classic (Light):** Flat opaque backgrounds, light gray incoming message bubbles, and green outgoing bubbles.
2. **Classic-Dark:** Optimized dark layouts with flat gray incoming bubbles and deep green outgoing bubbles.
3. **Ocean (Glassmorphic):** Deep sea blue-to-teal gradients, translucent frosted bubbles, and vibrant blue accents.
4. **Forest (Glassmorphic):** Vibrant forest green gradients with translucent bubbles and green accents.
5. **Sunset (Glassmorphic):** Rich warm red-to-orange gradients with translucent bubbles and red accents.
6. **Custom:** Allows custom colors and background image toggles.

### Glassmorphic Shared Variable Framework

For glassmorphic themes (Ocean, Forest, Sunset), the system applies uniform transparency and backdrop filtering overrides using custom properties:
* `--atoll-chat-header-bg`: Translucent glass header background (e.g., `rgba(15, 32, 39, 0.75)`).
* `--atoll-chat-header-backdrop-filter`: Applied to headers for high legibility (`blur(16px)`).
* `--atoll-chat-input-container-bg` & `--atoll-chat-input-backdrop-filter`: Creates floating, frosted input areas.
* `--atoll-chat-bubble-sent-backdrop-filter` & `--atoll-chat-bubble-received-backdrop-filter`: Applies custom glass filtering (`blur(8px)`) directly onto the text chat bubbles.
* `--atoll-chat-reaction-pill-backdrop-filter` & `--atoll-chat-date-separator-backdrop-filter`: Matches the overall glassmorphism style across all chat feed accessories.

---

## 7. Mathematical State Engine

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

---

## 8. Spatial Grid System (4px / 8px Base Grid)

Atoll Chat enforces a dual-density spatial grid system to ensure visual rhythm, predictable element alignment, and high touch accuracy.

```
Spatial Scale Concept (Base Unit = 8px, Micro Increment = 4px)

 [0px]  [4px]   [8px]    [12px]   [16px]    [24px]    [32px]    [48px]    [64px]
   │      │       │        │         │         │         │         │         │
   └──0───┴──1────┴──2─────┴──3──────┴──4──────┴──5──────┴──6──────┴──7──────┴──8──►
        Micro    Base    Micro-   Standard  Section   Container Component Structural
        Offset  Padding   Gap     Margin    Padding    Margin    Header    Banner
```

* **Micro-Grid (4px increments):** Used for fine-grained internal component padding, inline icon-to-text spacing, status badge offsets, and dense chat bubble metadata.
* **Macro-Grid (8px increments):** Used for external layout margins, card container padding, section spacing, and vertical list rhythm.

### Bootstrap `$spacers` Map Override

We expand Bootstrap’s default numeric spacing utility scale (`p-1`, `mb-3`, etc.) directly inside `src/scss/theme/_variables-primitives.scss`:

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

## 9. Responsive Breakpoints & Multi-Column Grid

Atoll Chat adapts fluidly from single-column mobile views to multi-pane desktop layouts.

| Breakpoint Tier | Target Screen Range | Active Columns | Outer Margin ($M_x$) | Column Gutter ($G_x$) | Primary UX Pattern |
| --- | --- | --- | --- | --- | --- |
| **`xs` (Mobile Portrait)** | **< 576px** | **4** | **16px** | **12px** | Single Column (Full Screen Feed / Chat Swap) |
| **`sm` (Mobile Landscape)** | **576px – 767px** | **4** | **16px** | **16px** | Single Column with Collapsible Sidebar Overlay |
| **`md` (Tablet Portrait)** | **768px – 991px** | **8** | **24px** | **16px** | Master-Detail Split (30% Nav / 70% Active Chat) |
| **`lg` (Desktop / Tablet LS)** | **992px – 1199px** | **12** | **32px** | **24px** | Master-Detail Split (320px List / Fluid Chat) |
| **`xl` (Large Desktop)** | **1200px – 1399px** | **12** | **32px** | **24px** | 3-Pane Layout (List / Active Chat / User Info) |
| **`xxl` (Ultra-Wide)** | **≥ 1400px** | **12** | **Auto (Max 1400px)** | **24px** | 3-Pane Layout with Fixed Max-Width Container |

These values are configured inside `src/scss/theme/_variables-layout.scss`:

```scss
$grid-breakpoints: (
  xs: 0,
  sm: 576px,
  md: 768px,
  lg: 992px,
  xl: 1200px,
  xxl: 1400px
);

$container-max-widths: (
  sm: 540px,
  md: 720px,
  lg: 960px,
  xl: 1140px,
  xxl: 1320px
);

$grid-columns: 12;
$grid-gutter-width: 1.5rem; // Default 24px
```

---

## 10. Gutter & Outer Margin Architecture

Horizontal rhythm ensures that messaging feeds, media grids, and settings panels remain legible regardless of display width.

```
Layout Layout Anatomy (Mobile vs. Desktop)

  Mobile View (<576px)                  Desktop Master-Detail View (≥992px)
  ┌─────────────────────────┐           ┌──────────────┬─────────────────────────┐
  ││ Mx │ Content │ Mx ││           ││ Mx │ List │Gx│ Active Chat    │ Mx ││
  ││16px│ Area    │16px││           ││32px│320px │24│ Fluid           │32px││
  ││    │         │    ││           ││    │      │px│                 │    ││
  └─────────────────────────┘           └──────────────┴─────────────────────────┘
```

### 1. Edge-to-Edge List Items
List containers (e.g., direct message feeds, chat room lists) extend to **0px** outer margins to allow full-width press/hover states across the device screen. Internal text and avatars apply the horizontal margin ($M_x$) internally:
* **Mobile List Item Padding:** `padding-left: 16px; padding-right: 16px;`
* **Desktop List Item Padding:** `padding-left: 20px; padding-right: 20px;`

### 2. Chat Feed Bubble Gutters
Message bubbles sit within a padded stream container to prevent text from clinging to display bezels:
* **Mobile Message Stream Side Margin:** **12px** from screen edges.
* **Desktop Message Stream Side Margin:** **24px** from pane borders.
* **Max Bubble Width:** **75%** of active chat pane width on mobile; **65%** on desktop.

---

## 11. Vertical Rhythm & Structural Dimensions

Consistent height constraints prevent layout shifting during real-time data streaming and keyboard toggles.

### Fixed Height Tokens

| Structural Component | Height Token | CSS Custom Property | Usage Rule |
| --- | --- | --- | --- |
| **Mobile Header / App Bar** | **56px** | `--atoll-header-height-mobile` | Fixed top bar on iOS/Android WebViews |
| **Desktop Header / App Bar** | **64px** | `--atoll-header-height-desktop` | Fixed top navigation bar on desktop |
| **Chat Room List Item** | **72px** | `--atoll-list-item-height-lg` | Contains 48px avatar, title, subtitle, timestamp badge |
| **Settings / Menu Item** | **56px** | `--atoll-list-item-height-md` | Standard option list row |
| **Compact List Item** | **48px** | `--atoll-list-item-height-sm` | Member selection lists, file list previews |
| **Bottom Chat Input Bar** | **56px (Min)** | `--atoll-input-bar-height` | Auto-expanding textarea with minimum 56px baseline |
| **Accessible Touch Target** | **44px x 44px** | `--atoll-touch-target-min` | Minimum clickable area for all icons and buttons |

---

## 12. Viewport Safe Areas (Capacitor Mobile & Notch Handling)

To prevent mobile OS overlays (iOS Home Indicator, Android Navigation Bar, Display Notches) from obscuring messaging UI elements, Atoll Chat integrates CSS `env(safe-area-inset-*)` variables directly into layout calculation rules inside `src/scss/theme/_theme-layout-insets.scss`:

```scss
:root {
  /* Safe Area Defaults (Fallback for Standard Desktop Web Browsers) */
  --atoll-safe-area-top: env(safe-area-inset-top, 0px);
  --atoll-safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --atoll-safe-area-left: env(safe-area-inset-left, 0px);
  --atoll-safe-area-right: env(safe-area-inset-right, 0px);

  /* Calculated Composite Dimensions */
  --atoll-header-height: 56px;
  --atoll-total-header-height: calc(var(--atoll-header-height) + var(--atoll-safe-area-top));
  --atoll-total-bottom-bar-height: calc(56px + var(--atoll-safe-area-bottom));
}

@media (min-width: 992px) {
  :root {
    --atoll-header-height: 64px;
  }
}
```

### Layout Utility Classes for Mobile Insets

These classes are available globally to adjust scroll pads and top/bottom offsets cleanly:

* **`.atoll-header-fixed`**: Fixed top app bar container with notch padding-top.
* **`.atoll-content-has-header`**: Scrollable body content padded below the fixed header.
* **`.atoll-footer-fixed`**: Fixed bottom input / toolbar container with safe home-indicator padding-bottom.
* **`.atoll-chat-feed-scroll`**: Scrollable message feed padded above the fixed bottom input bar.

---

## 13. Layout Integration Classes

The foundational layout and split-pane structural system is written inside `src/scss/theme/_layout.scss` to finalize the spatial system configuration.

* **`.atoll-main-layout`**: The master full-viewport flex container with dynamic viewport height support (`100dvh`).
* **`.atoll-sidebar-pane`**: Responsive master split-pane pane supporting offcanvas modes, sized at `100%` on mobile and tablet, `320px` on desktop, and `360px` on large desktop.
* **`.atoll-chat-pane`**: Responsive fluid messaging and chat detail pane, automatically hidden on mobile viewports when inactive.
* **`.atoll-touch-target`**: Accessible touch target enforcer which natively overrides min-width and min-height to comply with the $44\text{px} \times 44\text{px}$ minimum size standard.
