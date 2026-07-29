# Atoll Chat List & List Item Component Architecture (`atoll-list` & `atoll-list-item`)

Lists form the backbone of Atoll Chat screen layouts—powering Friend Directories, Chatroom Threads, Settings Navigation, Search Autocomplete, and Media Action Sheets.

The `atoll-list` and `atoll-list-item` components strictly implement the ** Design System for Messenger State-Driven List Architecture**.

---

## 1. State-Driven List Architecture

Standard web apps often cram "three-dot" context menus into every row. The system replaces row-level dropdowns with a **parent-driven state machine**:

* **`atoll-list` (The Brain):** Central global state manager for the row group. Dictates the active mode (`default`, `selection`, `edit`, `reorder`) and broadcasts mode updates to all child items simultaneously.
* **`atoll-list-item` (The Muscle):** Subservient track element. Listens to parent list mode changes and animates its internal 5-column sliding layout to reveal contextual controls.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  5-Column Sliding Track Layout                                         │
├─────────────────┬───────────────┬───────────────────────────────────────┬───────────────┬──────────────┤
│ 1. Contextual   │ 2. Leading    │ 3. Content Body (Center)              │ 4. Trailing   │ 5. Reorder   │
│    Action Zone  │    Zone       │                                       │    Zone       │    Zone      │
│  (Dynamic Left) │   (Static)    │                                       │   (Static)    │(Dynamic Right│
│                 │               │                                       │               │              │
│  [✓] Checkbox / │  [Avatar /    │  Title Text               [Timestamp] │  [Badge]      │  [≡] Drag    │
│  [-] Red Minus  │   Icon]       │  Description / Subtitle               │  [Chevron]    │      Handle  │
└─────────────────┴───────────────┴───────────────────────────────────────┴───────────────┴──────────────┘
```

---

## 2. List State Modalities & Behaviors

### 1. `default` Mode
* **Purpose:** Standard reading and navigation.
* **Behavior:** Entire list item is a tappable row. Tapping dispatches `atoll-item-click`. Dynamic action zones (Contextual Action and Reorder) are collapsed.

### 2. `selection` Mode
* **Purpose:** Bulk actions (archiving chats, forwarding messages to contacts).
* **Behavior:** Contextual Action Zone slides in from off-screen left revealing checkboxes. Tapping a row toggles `checked` state and dispatches `atoll-item-selection-toggle` instead of navigating.

### 3. `edit` (or Delete) Mode
* **Purpose:** Destructive list management.
* **Behavior:** Contextual Action Zone slides in from off-screen left revealing red minus buttons. Tapping the minus button fires `atoll-item-delete-trigger`.

### 4. `reorder` Mode
* **Purpose:** Custom item ordering.
* **Behavior:** Reorder Zone slides in from off-screen right revealing drag handles (`≡`). Drag-and-drop handles enable dragging rows up/down.

---

## 3. Web Component API

### 1. List Container (`<atoll-list>`)

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `divided` | `Boolean` | `false` | When true, renders separator lines between adjacent child items. |
| `mode` | `String` | `'default'` | State mode: `'default'`, `'selection'`, `'edit'`, or `'reorder'`. |

#### Programmatic DOM Methods
* `setMode(mode)`: Dynamically changes list mode and broadcasts to children.
* `selectAll()`: Checks all child items in `selection` mode.
* `clearSelection()`: Unchecks all child items in `selection` mode.
* `getSelectedItems()`: Returns array of checked `<atoll-list-item>` elements.

### 2. List Item Row (`<atoll-list-item>`)

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `String` | `''` | Primary title text. |
| `description` | `String` | `''` | Secondary description or preview text. |
| `timestamp` | `String` | `''` | Top-right metadata string. |
| `badge` | `String` | `''` | Unread badge count. |
| `size` | `String` | `'md'` | Height scale modifier: `'sm'` (48px), `'md'` (60px), or `'lg'` (72px). |
| `mode` | `String` | `'default'` | Row state mode (syncs automatically with parent `<atoll-list>`). |
| `checked` | `Boolean` | `false` | Checked state in `selection` mode. |
| `chevron` | `Boolean` | `false` | Renders trailing navigation arrow in default mode. |
| `clickable` | `Boolean` | `false` | Applies hover/active interactive states. |
| `highlighted` | `Boolean` | `false` | Soft green background tint. |
| `disabled` | `Boolean` | `false` | Opacity 45% and disables interactive events. |
| `selected` | `Boolean` | `false` | Selection highlight with 3px green left border accent. |

### Events Dispatched

| Event Name | Bubbles | Composed | Detail Payload | Description |
| --- | --- | --- | --- | --- |
| `atoll-item-click` | `true` | `true` | `{ title, selected, checked, mode }` | Dispatched on row tap in default mode. |
| `atoll-item-selection-toggle` | `true` | `true` | `{ title, checked }` | Dispatched when item check state is toggled in selection mode. |
| `atoll-item-delete-trigger` | `true` | `true` | `{ title }` | Dispatched when red minus button is tapped in edit mode. |
| `atoll-list-mode-change` | `true` | `true` | `{ mode, previousMode }` | Dispatched by `<atoll-list>` when list mode changes. |

---

## 4. Usage Patterns & Integration Examples

### 1. Selection Mode Batch Selection List
```html
<atoll-list mode="selection" id="contact-select-list">
  <atoll-list-item title="Alice" description="Hey, where are we meeting?" checked="true">
    <atoll-profile slot="left" src="/assets/avatars/alice.jpg" size="md"></atoll-profile>
  </atoll-list-item>
  <atoll-list-item title="Bob" description="Sent a photo.">
    <atoll-profile slot="left" src="/assets/avatars/bob.jpg" size="md"></atoll-profile>
  </atoll-list-item>
</atoll-list>
```

### 2. Edit / Delete Mode List
```html
<atoll-list mode="edit" divided="true">
  <atoll-list-item title="Blocked User 1" description="Blocked on 10/12">
    <atoll-profile slot="left" size="md"></atoll-profile>
  </atoll-list-item>
</atoll-list>
```

### 3. Reorder Mode Drag & Drop List
```html
<atoll-list mode="reorder">
  <atoll-list-item title="Pinned Chat 1" description="Always on top">
    <atoll-profile slot="left" size="md"></atoll-profile>
  </atoll-list-item>
</atoll-list>
```
