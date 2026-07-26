# Atoll Chat Typography Architecture

This document defines the typography foundation for Atoll Chat. This system guarantees optimal legibility, zero font download latency, and accessibility scaling across Web and Capacitor mobile platforms (iOS & Android).

---

## 1. Native System Font Stack

To ensure instant rendering performance, zero cumulative layout shift (CLS), and native OS integration, Atoll Chat uses system font stacks without external web fonts.

### SCSS Font Family Definitions

```scss
// scss/theme/_variables-typography.scss

// Native OS High-Performance System Font Stack
$font-family-sans-serif: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol" !default;

$font-family-monospace:  SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !default;

$font-family-code:       $font-family-monospace !default;
```

---

## 2. Modular Type Scale Matrix

The type scale balances high density in chat lists with comfortable legibility inside message streams.

| Scale Token | Pixel Size | Rem Size | Line Height | Font Weight | Core Functional Application |
| --- | --- | --- | --- | --- | --- |
| **`display`** | **32px** | `2.0rem` | `1.25` (40px) | Bold (`700`) | Onboarding hero screens, main empty states |
| **`title-1`** | **24px** | `1.5rem` | `1.30` (31px) | Bold (`700`) | Screen headers, modal dialog titles |
| **`title-2`** | **20px** | `1.25rem` | `1.35` (27px) | SemiBold (`600`) | Active chat header names, panel headings |
| **`title-3`** | **17px** | `1.0625rem` | `1.40` (24px) | SemiBold (`600`) | Chat room item titles, sender names in group chat |
| **`body-1`** | **16px** | `1.0rem` | `1.50` (24px) | Regular (`400`) / Medium (`500`) | **Standard Chat Bubble Message Body (Default)** |
| **`body-2`** | **14px** | `0.875rem` | `1.45` (20px) | Regular (`400`) | Settings sub-labels, search result previews, inputs |
| **`caption-1`** | **12px** | `0.75rem` | `1.33` (16px) | Regular (`400`) | Message timestamps, read receipt indicators |
| **`caption-2`** | **10px** | `0.625rem` | `1.20` (12px) | Medium (`500`) | Unread message count badges, active system tags |

---

## 3. SCSS Typography Variables Override

We override Bootstrap's native type system using `$atoll-` primitives and `$prefix` rules.

```scss
// scss/theme/_variables-typography.scss

// 1. Primitive Font Size Scale
$atoll-font-size-display:   2rem;       // 32px
$atoll-font-size-title-1:   1.5rem;     // 24px
$atoll-font-size-title-2:   1.25rem;    // 20px
$atoll-font-size-title-3:   1.0625rem;  // 17px
$atoll-font-size-body-1:    1rem;       // 16px
$atoll-font-size-body-2:    0.875rem;   // 14px
$atoll-font-size-caption-1: 0.75rem;    // 12px
$atoll-font-size-caption-2: 0.625rem;   // 10px

// 2. Line Heights
$atoll-line-height-display:   1.25;
$atoll-line-height-title-1:   1.3;
$atoll-line-height-title-2:   1.35;
$atoll-line-height-title-3:   1.4;
$atoll-line-height-body-1:    1.5;
$atoll-line-height-body-2:    1.45;
$atoll-line-height-caption-1: 1.33;
$atoll-line-height-caption-2: 1.2;

// 3. Font Weights
$font-weight-lighter: 300 !default;
$font-weight-normal:  400 !default;
$font-weight-medium:  500 !default;
$font-weight-semibold: 600 !default;
$font-weight-bold:    700 !default;

// 4. Native Bootstrap Overrides
$font-size-root: 16px !default;
$font-size-base: $atoll-font-size-body-1 !default; // 16px Default
$line-height-base: $atoll-line-height-body-1 !default;
```

---

## 4. Semantic CSS Custom Properties (`:root`)

CSS custom properties are attached to `:root` using SCSS string interpolation with `#{$prefix}` and referencing SCSS variables.

```scss
// scss/theme/_theme-typography.scss

:root {
  /* Font Family Stack */
  --#{$prefix}font-sans-serif: #{$font-family-sans-serif};
  --#{$prefix}font-monospace: #{$font-family-monospace};

  /* Font Sizes */
  --#{$prefix}font-size-display: #{$atoll-font-size-display};
  --#{$prefix}font-size-title-1: #{$atoll-font-size-title-1};
  --#{$prefix}font-size-title-2: #{$atoll-font-size-title-2};
  --#{$prefix}font-size-title-3: #{$atoll-font-size-title-3};
  --#{$prefix}font-size-body-1: #{$atoll-font-size-body-1};
  --#{$prefix}font-size-body-2: #{$atoll-font-size-body-2};
  --#{$prefix}font-size-caption-1: #{$atoll-font-size-caption-1};
  --#{$prefix}font-size-caption-2: #{$atoll-font-size-caption-2};

  /* Line Heights */
  --#{$prefix}line-height-display: #{$atoll-line-height-display};
  --#{$prefix}line-height-title-1: #{$atoll-line-height-title-1};
  --#{$prefix}line-height-title-2: #{$atoll-line-height-title-2};
  --#{$prefix}line-height-title-3: #{$atoll-line-height-title-3};
  --#{$prefix}line-height-body-1: #{$atoll-line-height-body-1};
  --#{$prefix}line-height-body-2: #{$atoll-line-height-body-2};
  --#{$prefix}line-height-caption-1: #{$atoll-line-height-caption-1};
  --#{$prefix}line-height-caption-2: #{$atoll-line-height-caption-2};

  /* Font Weights */
  --#{$prefix}font-weight-normal: #{$font-weight-normal};
  --#{$prefix}font-weight-medium: #{$font-weight-medium};
  --#{$prefix}font-weight-semibold: #{$font-weight-semibold};
  --#{$prefix}font-weight-bold: #{$font-weight-bold};
}
```

---

## 5. Typography Utility Classes

These typography utility classes integrate with Atoll Chat components:

```scss
// scss/theme/_typography-utilities.scss

.atoll-text-display {
  font-size: var(--#{$prefix}font-size-display);
  line-height: var(--#{$prefix}line-height-display);
  font-weight: var(--#{$prefix}font-weight-bold);
}

.atoll-text-title-1 {
  font-size: var(--#{$prefix}font-size-title-1);
  line-height: var(--#{$prefix}line-height-title-1);
  font-weight: var(--#{$prefix}font-weight-bold);
}

.atoll-text-title-2 {
  font-size: var(--#{$prefix}font-size-title-2);
  line-height: var(--#{$prefix}line-height-title-2);
  font-weight: var(--#{$prefix}font-weight-semibold);
}

.atoll-text-title-3 {
  font-size: var(--#{$prefix}font-size-title-3);
  line-height: var(--#{$prefix}line-height-title-3);
  font-weight: var(--#{$prefix}font-weight-semibold);
}

.atoll-text-body-1 {
  font-size: var(--#{$prefix}font-size-body-1);
  line-height: var(--#{$prefix}line-height-body-1);
  font-weight: var(--#{$prefix}font-weight-normal);
}

.atoll-text-body-2 {
  font-size: var(--#{$prefix}font-size-body-2);
  line-height: var(--#{$prefix}line-height-body-2);
  font-weight: var(--#{$prefix}font-weight-normal);
}

.atoll-text-caption-1 {
  font-size: var(--#{$prefix}font-size-caption-1);
  line-height: var(--#{$prefix}line-height-caption-1);
  font-weight: var(--#{$prefix}font-weight-normal);
}

.atoll-text-caption-2 {
  font-size: var(--#{$prefix}font-size-caption-2);
  line-height: var(--#{$prefix}line-height-caption-2);
  font-weight: var(--#{$prefix}font-weight-medium);
}

/* Multiline Truncation Utilities */
.atoll-text-truncate-1 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.atoll-text-truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

---

## 6. Dynamic Type & Mobile Accessibility (Capacitor iOS/Android)

On mobile platforms, users can scale system text sizes via OS accessibility settings. To prevent UI breakage while honoring accessibility scaling:

1. **`rem` Units for Body Text:** All body text, chat messages, and titles use `rem` units, allowing text to scale gracefully with OS user settings.
2. **`px` Constraints for Dense UI Containers:** Non-scalable items (such as the 56px fixed header, status bar badges, and icon buttons) use fixed pixel bounds so that scaled text gracefully truncates (`.atoll-text-truncate-1`) without breaking fixed structural bounds.
