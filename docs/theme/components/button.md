# Button & Capsule Component Specifications (`atoll-button`)

The `atoll-button` component is a flexible, highly accessible interactive element built on Coralite and styled with the Atoll Chat Design System. It supports both standard rectangular box buttons and fully rounded capsule (pill) button shapes.

---

## 1. Design Foundations & Geometry

Standard buttons use rounded corners with medium radius bounds, while Capsule/Pill buttons feature a fully rounded visual profile, tighter horizontal padding scales, and an optimized mobile touch target area.

```
┌────────────────────────────────────────────────────────────────────────┐
│                      Capsule (Pill) Button Anatomy                     │
├────────────────────────────────────────────────────────────────────────┤
│  ( Leading Icon Slot ) ──► [ Label (Default Slot) ] ──► ( Trailing )   │
│   border-radius: 9999px;   Horizontal Padding: ~1.25x Height ratio   │
└────────────────────────────────────────────────────────────────────────┘
```

### Visual Variants & Dark Mode Contrast Rules

| Variant | Light Mode Appearance | Dark Mode Appearance (`[data-atoll-theme="dark"]`) | Primary Application |
| --- | --- | --- | --- |
| **`primary`** | Solid Brand Green (`#06C755`), white text | Solid Brand Green (`#06C755`), white text | Floating quick actions, active audio call bar |
| **`secondary`** | Light surface (`#E8E8E8`), dark text | Dark surface (`#2A2A2A`), white text | Filter chips, contextual chat room tags |
| **`outline`** | Subtle border (`#D4D4D4`), transparent bg | Subtle border (`#3A3A3A`), transparent bg | Unselected floating filters, info chips |
| **`ghost`** | Transparent bg, hover tint | Transparent bg, white hover tint | Compact in-chat status triggers |
| **`danger`** | Solid alert red (`#FF334B`), white text | Solid alert red (`#FF334B`), white text | End call trigger, leave room floating chip |

---

## 2. Spatial Dimension & Scale

Standard box buttons keep their current heights for desktop and mobile comfort, while compact capsule/pill variants utilize optimized compact scales when combined with the `pill="true"` modifier.

### Spatial Sizing Mapping

| Size Token | Standard Box Height | Capsule Height | Capsule Padding | Typography Reference | Touch Target Boundary |
| --- | --- | --- | --- | --- | --- |
| **`sm`** | **32px** | **28px** | 12px | `caption-1` (12px / W600) | **44px** minimum touch target via invisible pseudo-element expansion |
| **`md`** | **44px** | **36px** | 16px | `body-2` (14px / W600) | Standard floating quick replies |
| **`lg`** | **52px** | **44px** | 20px | `body-1` (16px / W600) | Active media pills or main call-to-actions |

---

## 3. Advanced Touch Target Accessibility (`sm` Capsule)

To guarantee native AA compliance for mobile touchscreen inputs ($44\text{px} \times 44\text{px}$ minimum hit target) without visually modifying the compact $28\text{px}$ small capsule button height, an invisible expanded touch target is generated using an absolute pseudo-element:

```scss
.atoll-btn-pill.atoll-btn-sm {
  position: relative;

  &::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    min-width: 100%;
    min-height: 44px;
    width: 44px;
  }
}
```

---

## 4. Usage Patterns & Examples

### 1. Active Call Bar Trigger (Primary Capsule)

```html
<atoll-button pill="true" variant="primary" size="md">
  <atoll-icon slot="leading" name="phone" size="20"></atoll-icon>
  Return to Call (02:14)
</atoll-button>
```

### 2. Filter / Category Chip (Secondary Capsule)

```html
<atoll-button pill="true" variant="secondary" size="sm">
  Unread Only
  <atoll-badge slot="trailing" count="3" size="sm"></atoll-badge>
</atoll-button>
```

### 3. Floating Quick Reply Chip (Outline Capsule)

```html
<atoll-button pill="true" variant="outline" size="sm">
  <atoll-icon slot="leading" name="add" size="16"></atoll-icon>
  Quick Reply
</atoll-button>
```

### 4. End Call / Destructive Action Chip (Danger Capsule)

```html
<atoll-button pill="true" variant="danger" size="md">
  <atoll-icon slot="leading" name="phone" size="20"></atoll-icon>
  End Call
</atoll-button>
```
