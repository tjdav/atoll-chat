# Search Bar Component Specifications (`atoll-search-bar`)

The `atoll-search-bar` component is a high-frequency interaction container used to filter and locate content in real time. It combines a filled pill-shaped input container, a persistent leading search icon, a dynamic touch-safe clear trigger ('X'), and an optional sliding "Cancel" action CTA.

---

## 1. Design Foundations & Anatomy

An Atoll Search Bar features an outer container, a pill field, and an optional sliding Cancel button.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              Search Bar Component Anatomy                              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐                            │
│ │ [ Search Icon ]  [ Search Input Field... ]  [ Clear (X) ]│  [ Cancel / Back CTA ]    │
│ └─────────────────────────────────────────────────────────┘  (Appears when focused)   │
│   Pill Surface Container (`border-radius: 9999px`)                                     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Visual States & Behavior

| State | Visual Characteristics | Interaction Mechanics |
| --- | --- | --- |
| **Inactive / Default** | Subtle gray background (`--atoll-bg-surface-secondary`), placeholder text exposed | Clicking/tapping focuses the field and triggers focus state |
| **Focused / Active** | Primary border outline / glow, "Cancel" text CTA smoothly slides and fades in | Tapping "Cancel" clears query, blurs field, and restores initial view |
| **Typing** | Active query text, clear button ('X') becomes visible on the right | Tapping ('X') instantly clears input without losing input focus (touch-safe) |
| **Disabled** | 45% opacity, cursor not-allowed | All mouse and keyboard interactions blocked |

### Sizing Scale

| Size Token | Height | Search Icon Size | Typography | Primary UX Application |
| --- | --- | --- | --- | --- |
| **`sm`** | **32px** | `16px` (`xs`) | `caption-1` (12px) | Compact dropdown search, modal header filters |
| **`md` (Default)** | **38px** | `20px` (`sm`) | `body-2` (14px) | **Main Chat List header search, Friend directory search** |
| **`lg`** | **44px** | `24px` (`md`) | `body-1` (16px) | Hero search screens, global search overlays |

---

## 2. Public API & Helper Methods

The custom element exposes direct JavaScript APIs and properties on its DOM interface for flexible programmatic control:

### Properties

| Property | Type | Description | Bidirectional Binding |
| --- | --- | --- | --- |
| **`value`** | `string` | The current value of the search input field | Yes (`Object.defineProperty`) |

### Helper Methods

| Method | Signature | Description |
| --- | --- | --- |
| **`focus()`** | `() => void` | Focuses the internal search input field |
| **`blur()`** | `() => void` | Blurs the internal search input field |
| **`clear()`** | `() => void` | Clears the search input field programmatically |

---

## 3. Touch-Safe Clear Execution (`pointerdown`)

To prevent mobile virtual keyboards from flickering or input fields from losing focus when a user clears their query, the clear button handles `pointerdown` and `mousedown` events with `event.preventDefault()` prior to resetting the input and calling `.focus()`:

```javascript
clearBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault() // Prevents input blur on tap
  state.value = ''
  if (input) {
    input.value = ''
    input.focus()
  }
})
```

---

## 4. Usage Patterns & Examples

### 1. Main Chat List Filter Search Bar (Standard)

```html
<atoll-search-bar 
  placeholder="Search messages, friends, groups" 
  size="md"
></atoll-search-bar>
```

### 2. Header Search Bar with Cancel Action CTA

```html
<atoll-search-bar 
  placeholder="Search in conversation..." 
  show-cancel="true" 
  cancel-text="Cancel"
></atoll-search-bar>
```

### 3. Compact Search Bar in Modal Picker

```html
<atoll-search-bar 
  size="sm" 
  placeholder="Filter members..."
></atoll-search-bar>
```
