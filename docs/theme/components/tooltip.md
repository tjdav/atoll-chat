# Tooltip Component Specifications (`atoll-tooltip`)

The `atoll-tooltip` component is a flexible, highly accessible contextual helper element built on Coralite and styled with the Atoll Chat Design System.

Tooltips provide non-essential contextual helper text, feature discovery popovers, or action balloons near a target anchor element upon hover, focus, or click.

---

## 1. Design Foundations & Specification

The design system distinguishes between **Plain Text Tooltips** (subtle, transient hover guides) and **Action Popover Balloons** (rich feature onboarding bubbles with titles and close buttons).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Tooltip Component Anatomy                       │
├────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ [ Title (Optional) ]                         [ Close (X) Button ]│  │
│  │ Contextual message text or feature tip summary.                  │  │
│  └─────────────────────────────────┬────────────────────────────────┘  │
│                                    ▼ Pointer Arrow (Beak)              │
│                           [ Anchor Target Element ]                    │
└────────────────────────────────────────────────────────────────────────┘
```

### Visual Variants & Functional Applications

| Variant (`variant="..."`) | Surface Theme | Arrow Pointer | Primary UX Application |
| --- | --- | --- | --- |
| **`plain` (Default)** | Dark surface (`#2C2C2C` / white text) | Solid arrow beak | Short text helper on icon buttons or truncated chat titles |
| **`action` (Balloon)** | Elevated surface with shadow & border | Bordered arrow beak | New feature introduction, contextual onboarding, action prompts |

### Placement Tokens

The component supports 4 primary cardinal orientations relative to the anchor trigger:

* **`top` (Default):** Floats above the anchor target; arrow points down.
* **`bottom`:** Floats below the anchor target; arrow points up.
* **`left`:** Floats to the left of the anchor target; arrow points right.
* **`right`:** Floats to the right of the anchor target; arrow points left.

---

## 2. Theme SCSS Architecture (`src/scss/_atoll-tooltip.scss`)

This stylesheet controls arrow beak positioning, drop-shadow elevations, placement offset calculations, and dark mode theme variables using BEM modifier classes.

All properties utilize the custom prefix configured globally via `#{$prefix}`.

```scss
/* Plain Variant Color Tokens & Dimensions */
:root {
  --#{$prefix}tooltip-radius: 8px;
  --#{$prefix}tooltip-padding-x: 12px;
  --#{$prefix}tooltip-padding-y: 8px;
  --#{$prefix}tooltip-max-width: 280px;
  --#{$prefix}tooltip-arrow-size: 6px;
  --#{$prefix}tooltip-z-index: 1080;
  --#{$prefix}tooltip-bg: var(--#{$prefix}bg-surface-inverse, #222222);
  --#{$prefix}tooltip-color: #FFFFFF;
  --#{$prefix}tooltip-border: transparent;
}
```

### Dark Mode Support

In dark mode (`[data-bs-theme="dark"]`), the theme semantic variables are updated automatically for both the lightweight `plain` text tooltip and the elevated `action` onboarding balloon.

---

## 3. Interaction Models & Accessibility

The tooltip features excellent, fully compliant keyboard navigation and event handlers:

1. **Hover / Focus Trigger (`trigger="hover"`):**
   - Shows on `mouseenter` or `focusin` on the anchor target.
   - Hides on `mouseleave` or `focusout` from the anchor target.
2. **Click Trigger (`trigger="click"`):**
   - Toggles the `open` state on clicking the anchor target.
   - **Click-Outside Dismissal:** Clicking outside the component host automatically dismisses the tooltip.
3. **Escape Key Dismissal:**
   - Pressing the `Escape` key globally when the tooltip is active immediately dismisses it.
4. **ARIA Compliant Attributes:**
   - Automatically generates unique IDs to link the trigger to the bubble element via `aria-describedby` matching the bubble's `id`.
   - Binds `role="tooltip"` for the plain text variant and `role="dialog"` for the action balloon variant.

---

## 4. Attributes, Slots, & Events API

### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| **`text`** | `String` | `''` | Body content text message. Overridden by slot projection. |
| **`title`** | `String` | `''` | Title header text, primarily used for the `action` variant. |
| **`placement`** | `String` | `'top'` | Bubble placement: `'top'`, `'bottom'`, `'left'`, `'right'`. |
| **`variant`** | `String` | `'plain'` | Style variant: `'plain'` (default), `'action'` (balloon). |
| **`trigger`** | `String` | `'hover'` | Interaction trigger: `'hover'` or `'click'`. |
| **`open`** | `Boolean` | `false` | Sets the visual visibility state. |
| **`closeable`** | `Boolean` | `false` | Renders a close "X" button in the header (only applicable to action headers). |

### Slots

| Slot Name | Description |
| --- | --- |
| **`(default)`** | The anchor trigger element wrapper. |
| **`content`** | Custom rich template inside the body (overrides the `text` attribute). |

### Custom Events

| Event Name | Detail Payload | Trigger Condition |
| --- | --- | --- |
| **`atoll-tooltip-close`** | `None` | Dispatched when the close "X" button inside an active action tooltip is clicked. |

### Public DOM API Methods

Public methods are exposed directly on the custom element's host DOM node:
- **`root.show()`**: Opens the tooltip (`state.open = true`).
- **`root.hide()`**: Closes the tooltip (`state.open = false`).

---

## 5. Usage Patterns & Examples

### 1. Plain Hover Tooltip on Icon Button

```html
<atoll-tooltip text="Mute conversation" placement="top">
  <atoll-button icon-only="true" variant="ghost" size="sm" aria-label="Mute">
    <atoll-icon name="close" size="18"></atoll-icon>
  </atoll-button>
</atoll-tooltip>
```

### 2. Action Onboarding Balloon with Close Trigger

```html
<atoll-tooltip 
  variant="action" 
  trigger="click" 
  title="New Voice Stage" 
  text="Start real-time audio rooms directly inside your OpenChat community." 
  placement="bottom" 
  closeable="true"
  open="true"
>
  <atoll-button variant="primary" size="md">Create Stage</atoll-button>
</atoll-tooltip>
```
