# Atoll Chat Iconography Architecture

This document defines the iconography foundation for Atoll Chat, integrating **`duo-icons` (v2.0.1)** under the **Coralite framework architecture**.

The iconography system features scalable grid alignment, a responsive dual-layer duotone engine, a custom registry utility with input normalization, and a reusable `<atoll-icon>` Coralite custom component.

---

## 1. Sizing Scale (4px Alignment Grid)

All icons are designed on a square bounding box aligned to Atoll Chat's 4px micro-grid.

| Size Token | Pixel Boundary | CSS Variable | Primary UX Application |
| --- | --- | --- | --- |
| **`xs`** | **16px** | `--atoll-icon-size-xs` | Inline text badges, status indicators, dense list metadata |
| **`sm`** | **20px** | `--atoll-icon-size-sm` | Compact list items, secondary form controls, dropdown menus |
| **`md` (Default)** | **24px** | `--atoll-icon-size-md` | **Primary action buttons, chat bar triggers, top nav items** |
| **`lg`** | **32px** | `--atoll-icon-size-lg` | Panel headers, modal dialog titles, featured actions |
| **`xl`** | **48px** | `--atoll-icon-size-xl` | Onboarding hero illustrations, empty states, call triggers |

---

## 2. Dual-Layer (Duotone) Color Engine

`duo-icons` consist of two distinct SVG paths per icon: a **primary layer** (strokes/main forms) and a **secondary layer** (background fills/accents).

```
 ┌─────────────────────────────────────────────────────────────┐
 │                         <atoll-icon>                        │
 ├──────────────────────────────┬──────────────────────────────┤
 │ Primary Layer Path           │ Secondary Layer Path         │
 │ • Color: currentColor        │ • Color: currentColor        │
 │ • Opacity: 1.0 (Solid)       │ • Opacity: 0.35 (Translucent)│
 └──────────────────────────────┴──────────────────────────────┘
```

The iconography SCSS theme handles default sizing and dual-layer color inheritance.

```scss
// src/scss/theme/_theme-iconography.scss

:root {
  /* Default Icon Sizing Scale (4px Grid) */
  --#{$prefix}icon-size-xs: 16px;
  --#{$prefix}icon-size-sm: 20px;
  --#{$prefix}icon-size-md: 24px;
  --#{$prefix}icon-size-lg: 32px;
  --#{$prefix}icon-size-xl: 48px;

  /* Color Inheritance Defaults */
  --#{$prefix}icon-primary-color: currentColor;
  --#{$prefix}icon-secondary-color: currentColor;
  --#{$prefix}icon-secondary-opacity: 0.35;
}

/* Iconography styling */
.atoll-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  width: var(--#{$prefix}icon-size, 24px);
  height: var(--#{$prefix}icon-size, 24px);
  flex-shrink: 0;

  svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  /* duo-icons Layer Rules */
  .duo-icon-primary,
  .duo-icons-primary-layer,
  path:first-child {
    fill: var(--#{$prefix}icon-primary-color, currentColor);
  }

  .duo-icon-secondary,
  .duo-icons-secondary-layer,
  path:nth-child(2) {
    fill: var(--#{$prefix}icon-secondary-color, currentColor);
    opacity: var(--#{$prefix}icon-secondary-opacity, 0.35);
  }
}
```

---

## 3. Icon Registry Utility (`src/utils/icon-registry.js`)

This module wraps `duo-icons`'s internal SVG path map (`duoIcons.icons`). It exports a lightweight, normalized lookup helper `getIconSvg(name)` to construct complete scalable `<svg>` tags.

### Normalization & Aliases
The registry automatically normalizes names of all cases (camelCase, kebab-case, snake_case) to `snake_case` (e.g. `mic-off` $\rightarrow$ `mic_off`, `addCircle` $\rightarrow$ `add_circle`) to correctly query duo-icons.
It maps standard aliases such as `video` $\rightarrow$ `computer_camera` and `video-off` $\rightarrow$ `computer_camera-off`.

### Custom Duotone Fallbacks
For critical messaging icons not present in `duo-icons` v2.0.1, the registry implements inline, highly optimized duotone SVG path pairs with appropriate classes (`.duo-icon-primary` and `.duo-icon-secondary`) to guarantee an identical visual aesthetic:
* `mic`
* `mic_off` (Mute button)
* `search` (Header input search)
* `phone` (Audio call initiator / hangup triggers)

---

## 4. The Coralite Icon Component (`src/components/common/atoll-icon.html`)

The `<atoll-icon>` element is registered as a native, lightweight Coralite component. It uses flat-option getters to evaluate custom sizing scales and registers automatic observers for reactive attribute updates.

### Usage Examples

#### 1. Declarative Usage in Templates
```html
<!-- Micro Sizing (16px) with default text color inheritance -->
<atoll-icon name="search" size="16"></atoll-icon>

<!-- Standard 24px Icon with custom accessibility label -->
<atoll-icon name="mic" size="24" aria-label="Microphone active"></atoll-icon>

<!-- Custom sizes (sm, md, lg, etc.) and explicit duotone colors -->
<atoll-icon 
  name="video-off" 
  size="lg" 
  color="#FF334B" 
  secondary-color="#FF334B"
></atoll-icon>
```

#### 2. Imperative Creation in Scripts
To mount an icon dynamically via client scripts, instantiate it using hyphenated element creation:
```javascript
// Correct imperative mounting inside a client script block
const icon = document.createElement('atoll-icon');
icon.setAttribute('name', 'settings');
icon.setAttribute('size', '20');
parentElement.appendChild(icon);
```
