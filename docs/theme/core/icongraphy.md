# Atoll Chat Iconography Architecture

This document defines the iconography foundation for Atoll Chat, integrating **`@solar-icons/js` (v2.0.0-beta.2)** under the **Coralite framework architecture**.

The iconography system features scalable grid alignment, a responsive dual-layer duotone engine, a custom registry utility with input normalization, and a reusable `<atoll-icon>` Coralite custom component using **BoldDuotone** variant icons.

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

## 2. Dual-Layer (BoldDuotone) Color Engine

Solar BoldDuotone icons consist of two distinct visual layers: a **primary layer** (solid forms/outlines) and a **secondary layer** (accent shapes/fills).

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
// src/scss/_atoll-icon.scss

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

  /* Solar Secondary Fill Custom Properties */
  --solar-secondary-color: var(--#{$prefix}icon-secondary-color, currentColor);
  --solar-secondary-opacity: var(--#{$prefix}icon-secondary-opacity, 0.35);
}

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
}
```

---

## 3. Icon Registry Utility (`src/utils/icon-registry.js`)

This module maps Atoll's semantic icon identifiers to `@solar-icons/js` AST definitions. It exports a `renderIcon(wrapper, options)` helper using Solar's `createIcons()` API.

### Core Mappings & Semantic Aliases
- **Chat Actions**: `send` (`SendSquareBoldDuotoneIcon`), `attach` (`PaperclipBoldDuotoneIcon`), `emoji` (`SmileCircleBoldDuotoneIcon`)
- **Sidebar Menu Items**: `gallery` (`GalleryBoldDuotoneIcon`), `menu-music` (`PlaylistMinimalistic2BoldDuotoneIcon`), `menu-videos` (`VideocameraRecordBoldDuotoneIcon`), `menu-documents` (`DocumentsBoldDuotoneIcon`), `menu-links` (`LinkCircleBoldDuotoneIcon`)
- **Navigation & Settings**: `search` (`MagnifierBoldDuotoneIcon`), `phone` (`PhoneBoldDuotoneIcon`), `video` (`VideocameraBoldDuotoneIcon`), `mic` (`MicrophoneBoldDuotoneIcon`), `mic-off` (`MutedBoldDuotoneIcon`), `settings` (`SettingsBoldDuotoneIcon`), `logout` (`LogoutBoldDuotoneIcon`), `close` (`CloseCircleBoldDuotoneIcon`)

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

<!-- Chat input send button -->
<atoll-icon name="send" size="20"></atoll-icon>

<!-- Custom sizes (sm, md, lg, etc.) and explicit duotone colors -->
<atoll-icon 
  name="camera-off" 
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
