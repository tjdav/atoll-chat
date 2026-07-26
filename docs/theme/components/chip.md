# Chips Component Specifications (`atoll-chip`)

The `atoll-chip` component is a flexible, compact interactive element built on Coralite and styled with the Atoll Chat Design System. 

Chips represent compact interactive elements used for filters, contextual selection tags, active recipient entries in multi-select search inputs, and dynamic action triggers across chat lists and search panels.

---

## 1. Interaction Models & Specification

Chips support three primary interaction models:

1. **Filter / Choice Chips:** Toggleable selection tags (e.g., "Unread", "Group Chats", "Mentions").
2. **Input / Tag Chips (Removable):** Represent selected entities (e.g., added contacts in a group creation bar) with an explicit removal trigger.
3. **Action Chips:** Interactive triggers that initiate contextual popovers or filter modals (e.g., "+ Add Filter").

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                Chip Component Anatomy                            │
├──────────────────────────────────────────────────────────────────────────────────┤
│ [ Leading Slot ] ──► [ Label (Default Slot) ] ──► [ Trailing Slot ] ──► [ Remove ]│
│ (e.g., Avatar/Icon)     "Group Chats"              (e.g., Badge)        (close)  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Visual Variants & States

| Variant Token | Unselected Appearance | Selected Appearance (`selected="true"`) | UX Application |
| --- | --- | --- | --- |
| **`secondary` (Default)** | Light gray surface (`--atoll-bg-surface-secondary`) | Solid Brand Green background with white text | Standard chat list filters & search tags |
| **`outline`** | Transparent background, 1px subtle border | Solid Brand Green background, white text | Clean inline tags, recipient input bar |
| **`primary`** | Solid Brand Green fill | Darkened Brand Green fill | High-emphasis filter actions |

---

## 2. Spatial Dimension & Scale

Chips feature pill geometry (`border-radius: 9999px`). Compact sizes (`sm` and `md`) employ an invisible expanded touch boundary (`::before`) to meet mobile tap target requirements ($44\text{px} \times 44\text{px}$).

| Size Token | Height | Horizontal Padding | Icon / Avatar Size | Touch Target Boundary | Primary UX Application |
| --- | --- | --- | --- | --- | --- |
| **`sm`** | **28px** | 10px | `16px` (`xs`) | $44\text{px} \times 44\text{px}$ (via `::before`) | High-density search recipient tags, input field tokens |
| **`md` (Default)** | **32px** | 12px | `20px` (`sm`) | $44\text{px} \times 44\text{px}$ (via `::before`) | Chat list filter bar, category selectors |
| **`lg`** | **38px** | 16px | `24px` (`md`) | $44\text{px}$ (Native) | Standalone modal tags, onboarding choices |

---

## 3. Image Area & Optical Edge Alignment

Slotted elements into `slot="leading"` (or elements with the class `.atoll-chip-avatar`) are automatically processed for visual correctness:

1. **Automatic Image Formatting:** Any slotted image is styled as a circular cropped image (`border-radius: 50%`, `object-fit: cover`).
2. **Optical Edge Alignment:** When a chip contains an avatar/image, its left padding is automatically tightened (reduced from `12px` to `4px` or `6px`) so the circular element sits snug against the curved pill border without wasting horizontal space.

---

## 4. Advanced Touch Target Accessibility (`sm` & `md`)

To guarantee native AA compliance for mobile touchscreen inputs ($44\text{px} \times 44\text{px}$ minimum hit target) on compact chips, an invisible expanded touch target is generated using an absolute pseudo-element. 

To ensure child slots and close buttons remain fully interactive and are not blocked by the invisible touch boundary, they are elevated in the stacking context (`position: relative` with appropriate `z-index`):

```scss
.atoll-chip-content {
  position: relative;
  z-index: 1; /* Elevate content above the invisible touch boundary */
}

.atoll-chip-remove {
  position: relative;
  z-index: 2; /* Sit on top of ::before touch target */
}

.atoll-chip-sm {
  height: 28px;
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
    z-index: 0;
  }
}
```

---

## 5. Attributes, Slots, & Events API

### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| **`variant`** | `String` | `'secondary'` | Visual style: `'secondary'`, `'outline'`, `'primary'`. |
| **`size`** | `String` | `'md'` | Height & spacing size token: `'sm'`, `'md'`, `'lg'`. |
| **`selected`** | `Boolean` | `false` | Sets selected visual appearance and sets `role="option"` with `aria-selected`. |
| **`removable`** | `Boolean` | `false` | Appends close button to the right of the chip. |
| **`disabled`** | `Boolean` | `false` | Visual opacity/pointer-events block, sets `tabindex="-1"`, and intercepts click actions. |
| **`value`** | `String` | `''` | Payload associated with the chip, returned in the removal custom event. |

### Slots

| Slot Name | Description |
| --- | --- |
| **`(default)`** | The primary label text / children inside the chip. |
| **`leading`** | Slotted elements (e.g. `img` or `atoll-icon`) rendered on the far left. |
| **`trailing`** | Slotted elements (e.g. `atoll-badge`) rendered on the right. |

### Custom Events

| Event Name | Detail Payload | Trigger Condition |
| --- | --- | --- |
| **`atoll-chip-remove`** | `{ value: String }` | Dispatched from the host when the remove/close button is clicked or Backspace/Delete are pressed on a focused removable chip. |

### Keyboard Navigation

- **Enter / Space:** Triggers a standard click event on the chip (to toggle selection/choice).
- **Backspace / Delete:** Triggers the close/removal action when focused on a removable chip.

---

## 6. Usage Patterns & Examples

### 1. Toggleable Chat List Filter Bar (Choice Group)

```html
<div class="d-flex gap-2 align-items-center">
  <atoll-chip selected="true" value="all">All Chats</atoll-chip>
  <atoll-chip selected="false" value="unread">
    Unread
    <atoll-badge slot="trailing" count="5" size="sm" variant="danger"></atoll-badge>
  </atoll-chip>
  <atoll-chip selected="false" value="groups">Groups</atoll-chip>
</div>
```

### 2. Recipient Tag in Multi-Select Contact Picker (Removable Chip)

```html
<atoll-chip removable="true" size="sm" value="user_102">
  <img slot="leading" src="/assets/avatars/user1.jpg" alt="">
  Alex Morgan
</atoll-chip>
```

### 3. Action Chip with Leading Icon

```html
<atoll-chip variant="outline" size="md">
  <atoll-icon slot="leading" name="add" size="18"></atoll-icon>
  Add Filter
</atoll-chip>
```
