# Input Component Specifications (`atoll-input`)

The `atoll-input` component is a flexible, highly accessible text input element built on Coralite and styled with the Atoll Chat Design System. It features an underline indicator with focus transition states, size scale modifiers, character counters, a clearable trigger, password visibility toggles, and countdown timers.

---

## 1. Design Foundations & Anatomy

Unlike standard boxed inputs, `atoll-input` fields rely on a clean **bottom underline border** that dynamically transitions state colors (Gray $\rightarrow$ Green $\rightarrow$ Red).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Input Component Anatomy                         │
├────────────────────────────────────────────────────────────────────────┤
│  Label (Optional) *                                           0 / 50   │
│  [ Input Field Text Area ]               [ Reset (X) ] [ Password Eye ] │
│  ────────────────────────────────────────────────────────────────────  │
│  Underline Indicator (1px Gray / 2px Green / 2px Red)                  │
│  Helper / Error Text Message                                02:36      │
└────────────────────────────────────────────────────────────────────────┘
```

### Key Functional Features

1. **Underline Indicator:** Bottom border indicating focus state. Gray (Inactive), Green (`#06C755`, Focused), Red (`#FF334B`, Error).
2. **Reset/Clear Button (`clearable`):** An inline clear icon (`atoll-icon[name="close"]`) that appears when text is entered and the field is active, clearing the value in one click.
3. **Password Show/Hide Toggle:** Switches field type between `password` and `text` with dynamic eye icon updates.
4. **Text Counter:** Displays current character length against maximum allowed capacity (e.g., `18 / 50`).
5. **Code / Verification Timer (`code` mode):** Displays a countdown timer (e.g., `02:36`) and optional trailing text button (e.g., "Resend code").

---

## 2. Spatial Dimension & Scale

The `atoll-input` component supports three sizes (`sm`, `md`, `lg`) designed to fit seamlessly in high-density forms, standard settings, and hero/onboarding screens.

### Sizing Scale

| Size Token | Height / Font Size | Label Size | Primary Application |
| --- | --- | --- | --- |
| **`sm`** | **36px** field / `12px` text | `11px` | High-density forms, modal sub-fields |
| **`md` (Default)** | **44px** field / `14px` text | `12px` | **Standard chat settings, auth forms, profile edits** |
| **`lg`** | **52px** field / `16px` text | `14px` | Hero profile name edits, standalone onboarding screens |

---

## 3. SCSS Theme Variables & Architecture

Styles reside in `src/scss/_atoll-input.scss` and integrate with Bootstrap custom prefixes and the color variable framework.

### CSS Custom Properties
- `--#{$prefix}input-height-sm`: Sizing height for `sm` input (36px).
- `--#{$prefix}input-height-md`: Sizing height for `md` input (44px).
- `--#{$prefix}input-height-lg`: Sizing height for `lg` input (52px).
- `--#{$prefix}input-text-color`: Direct text foreground color.
- `--#{$prefix}input-placeholder-color`: Placeholder text foreground color.
- `--#{$prefix}input-underline-color`: Default gray inactive bottom border color.
- `--#{$prefix}input-underline-focus`: Brand primary green focused border color.
- `--#{$prefix}input-underline-error`: Rainbow red error border color.
- `--#{$prefix}input-label-color`: Accent/secondary color for input label text.

---

## 4. Usage Patterns & Examples

### 1. Standard Profile Input with Label & Clear Button

```html
<atoll-input 
  label="Display Name" 
  value="Alex Morgan" 
  clearable
  required
  maxlength="50" 
  show-counter
></atoll-input>
```

### 2. Password Input with Toggle Eye

```html
<atoll-input 
  type="password" 
  label="Password" 
  placeholder="Enter account password" 
  required
></atoll-input>
```

### 3. Verification Code Input with Countdown & Action CTA

```html
<atoll-input 
  type="code" 
  label="6-Digit Verification Code" 
  placeholder="935915" 
  timer="02:36" 
  maxlength="6"
>
  <button slot="action" style="background: none; border: none; color: #06C755; font-size: 14px; font-weight: bold; cursor: pointer;">
    Resend code
  </button>
</atoll-input>
```

### 4. Input in Error State

```html
<atoll-input 
  label="Email Address" 
  value="invalid-email-address" 
  invalid
  error-message="An error has occurred. Incorrect email format."
></atoll-input>
```
