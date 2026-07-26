# Atoll Popup / Modal Architecture (`atoll-popup`)

By leveraging **Bootstrap's Modal JavaScript engine** under the hood, `atoll-popup` provides reliable focus traps, keyboard management (`Escape` key close), backdrop dimming, and body scroll locking, while completely styling the visual presentation to match Atoll Chat's rounded, elevated popup surface aesthetic.

---

## 1. Design Foundations & Anatomy

Atoll popups (also referred to as alerts, dialogs, or confirmation modals) are floating overlay cards used for critical user decisions, system alerts, feature introductions, and short contextual actions.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Popup / Modal Anatomy                           │
├────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │                  [ Hero Illustration / Icon Slot ]                 │ │
│ │                             (Optional)                             │ │
│ │                                                                    │ │
│ │                         Popup Title Text                           │ │
│ │                  Description / Body Helper Text                    │ │
│ │                                                                    │ │
│ │ ┌────────────────────────────────────────────────────────────────┐ │ │
│ │ │ [ Secondary Action Button ]    [ Primary Action Button (CTA) ] │ │ │
│ │ └────────────────────────────────────────────────────────────────┘ │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ Dimmed Backdrop Overlay (`rgba(0, 0, 0, 0.55)`)                       │
└────────────────────────────────────────────────────────────────────────┘
```

### Functional Popup Types

| Type (`variant="..."`) | Layout Alignment | Button Arrangement | Primary Application |
| --- | --- | --- | --- |
| **`alert`** | Centered text | Single **Primary Green** CTA button | Information notices, system warnings, permission requests |
| **`confirm` (Default)** | Centered text | Horizontal row: **Secondary** (Cancel) + **Primary Green** (Confirm) | Reversible user actions, navigation confirmations |
| **`danger`** | Centered text | Horizontal row: **Secondary** + **Primary Red** (`atoll-btn-danger`) | Destructive actions (e.g., "Delete Chat History", "Leave Group") |
| **`graphic`** | Centered text + Hero Graphic | Vertical stack or Horizontal row | promos, feature announcements, onboarding |

### Sizing & Geometry Tokens

Atoll popups use pronounced **16px–20px rounded corners**, compact width limits for optimal mobile readability, and generous internal padding.

| Size Token | Max Width | Internal Padding | Typical Device UX |
| --- | --- | --- | --- |
| **`sm`** | **300px** | 20px | Compact mobile alert dialogs, quick confirmation popups |
| **`md` (Default)** | **360px** | 24px | **Standard chat confirmations, prompt dialogs** |
| **`lg`** | **480px** | 32px | Feature announcements, form modals, complex multi-step dialogs |

---

## 2. Web Component API (`<atoll-popup>`)

The popup component is defined as a Coralite component with the following attribute API:

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `open` | `Boolean` | `false` | Controls the opening state of the popup. |
| `title` | `String` | `''` | The main title text of the popup. |
| `description` | `String` | `''` | Subtitle or descriptions. If left empty, is hidden. |
| `hero-icon` | `String` | `''` | Name of the icon to render in the hero slot wrapper. |
| `variant` | `String` | `'confirm'` | Theme variants: `'alert'`, `'confirm'`, `'danger'`, `'graphic'`. |
| `size` | `String` | `'md'` | Layout sizes: `'sm'`, `'md'`, `'lg'`. |
| `primary-text` | `String` | `'OK'` | Label text for the primary confirm button. |
| `secondary-text` | `String` | `'Cancel'` | Label text for the secondary/cancel button. |
| `stacked-actions`| `Boolean` | `false` | Sets button layout to vertical column-reverse stack. |
| `static-backdrop`| `Boolean` | `false` | If true, prevents closing on backdrop clicks. |

### Component Events

| Event Name | Event Detail Payload | Description |
| --- | --- | --- |
| `atoll-popup-open` | `{ variant, size }` | Dispatched immediately after the modal becomes visible to the user. |
| `atoll-popup-close` | `{ variant }` | Dispatched immediately after the modal is hidden. |
| `atoll-popup-primary` | `{ variant, size }` | Dispatched when the primary CTA action button is clicked. Does *not* auto-close. |
| `atoll-popup-secondary`| `{ variant }` | Dispatched when secondary action button is clicked. Auto-closes immediately. |

---

## 3. Styling Modifiers (CSS/SCSS)

All styles reside in `src/scss/_atoll-popup.scss` and override Bootstrap's modal styles under the `#{$prefix}` custom namespace.

- `.atoll-popup-dialog`: Centers and shapes the outer dialog frame.
- `.modal-backdrop.atoll-popup-backdrop`: Scopes the blurred and dimmed backdrop overlay Specifically to Atoll Popups without affecting standard Bootstrap modals globally.
- `.atoll-popup-hero`: Graphic container that automatically toggles visibility via `MutationObserver` if a slotted element is provided or `heroIcon` is present.
- `.atoll-popup-actions`: Stretches action buttons horizontally to equal width, or stacks them vertically when `.atoll-popup-actions-stacked` is active.

---

## 4. Usage Patterns & Integration Examples

### 1. Simple Confirmation Popup
```html
<atoll-popup 
  id="deleteConfirmModal"
  variant="confirm" 
  title="Clear Chat History?" 
  description="This will permanently remove all messages from this device. This action cannot be undone."
  primary-text="Clear History"
  secondary-text="Cancel"
></atoll-popup>
```

### 2. Destructive Action Popup (`variant="danger"`)
```html
<atoll-popup 
  id="leaveGroupModal"
  variant="danger" 
  title="Leave Group Chat?" 
  description="You will no longer receive messages or be able to view group media."
  primary-text="Leave Group"
  secondary-text="Stay"
></atoll-popup>
```

### 3. Slotted Hero Graphic Announcement (`variant="graphic"`)
```html
<atoll-popup 
  id="featureModal"
  variant="graphic" 
  size="lg"
  title="Welcome to Atoll Chat" 
  description="Explore secure public communities, custom admin badges, and real-time voice stages."
  primary-text="Explore Now"
  secondary-text="Maybe Later"
>
  <img slot="hero" src="/assets/illustrations/atoll-promo.svg" alt="Promo" width="120" height="120" />
</atoll-popup>
```

### 4. Custom Body Form Content
```html
<atoll-popup 
  id="renameGroupModal"
  title="Edit Group Name"
  primary-text="Save"
  secondary-text="Cancel"
>
  <!-- Slotted input content -->
  <div class="mt-3">
    <atoll-input 
      label="Group Name" 
      value="LINE Design System Team" 
      clearable="true" 
      maxlength="30"
      show-counter="true"
    ></atoll-input>
  </div>
</atoll-popup>
```
