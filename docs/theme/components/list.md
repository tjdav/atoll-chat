# Atoll Chat List & List Item Component Architecture (`atoll-list` & `atoll-list-item`)

Lists form the backbone of Atoll Chat screen layouts—powering Friend Directories, Chatroom Threads, Settings Navigation, Search Autocomplete, and Media Action Sheets.

---

## 1. Atoll Chat Design Foundations & Anatomy

An Atoll Chat List Item consists of three horizontal zones: a **Left Area** (avatars, icons, media thumbnails), a **Center Text Area** (title, description), and a **Right Option Area** (controls, metadata, badges, chevrons).

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                 List Item Anatomy                                       │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────┐  ┌───────────────────────────────────────────────┐  ┌───────────────┐ │
│ │  3-1. LEFT    │  │ 3-2. TEXT AREA (Custom)                       │  │ 3-3. RIGHT    │ │
│ │  (Optional)   │  │                                               │  │  Option Area  │ │
│ │  Profile /    │  │  Title / Name Text            [Timestamp]     │  │  Switch /     │ │
│ │  Thumbnail /  │  │  Description / Last Message                   │  │  Chevron /    │ │
│ │  Icon         │  │                                               │  │  Badge / Check│ │
│ └───────────────┘  └───────────────────────────────────────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Visual Anatomy & Component Zones

1. **Left Area (Guided / Optional):**
   - **Profile Avatar:** `<atoll-profile>` (Single user or multiparty group avatar).
   - **Media Thumbnails:** Aspect ratios 1:1 (Square), 4:3, 16:9, or 2.2:8 (Wide banner).
   - **Selection Controls:** Radio buttons or Checkboxes during batch-edit mode.
   - **Service Icons:** Icon graphics (e.g. LINE Pay, LINE Music, Settings gear).

2. **Center Text Area:**
   - **Title:** Primary item label or user name (bold/semibold font).
   - **Description:** Subtitle, message preview, or status summary (truncated to 1 or 2 lines).

3. **Right Option Area (Guided / Optional):**
   - **Interactive Controls:** Toggle Switch, Checkbox, Radio, Text Button, Icon Button.
   - **Metadata & Badges:** Timestamp (`10:42 AM`), Unread Count Badge (`<atoll-badge>`).
   - **Navigation Indicators:** Directional Chevron (`<atoll-icon name="chevron-right">`).

---

## 2. Web Component API

### 1. List Container (`<atoll-list>`)

The container holds a group of list items and optionally applies dividers between siblings.

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `divided` | `Boolean` | `false` | When true, renders separator lines between adjacent child items. |

### 2. List Item Row (`<atoll-list-item>`)

The row component handles title fallbacks, unread badges, directional indicators, and click events.

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `String` | `''` | Standard title text. Projects to fallback title area if default slot is empty. |
| `description` | `String` | `''` | Secondary description or message preview text. |
| `timestamp` | `String` | `''` | Optional right-aligned timestamp metadata. |
| `badge` | `String` | `''` | Optional unread count badge count. |
| `size` | `String` | `'md'` | Row height scale modifier: `'sm'` (48px), `'md'` (60px), or `'lg'` (72px). |
| `chevron` | `Boolean` | `false` | If true, renders a trailing navigation arrow and sets interactive cursor. |
| `clickable` | `Boolean` | `false` | Sets interactive hover/active states, pointer cursor, role, and tabindex. |
| `highlighted` | `Boolean` | `false` | Applies a subtle green tinted background. |
| `disabled` | `Boolean` | `false` | Sets opacity to 45% and disables all mouse, touch, and focus events. |
| `selected` | `Boolean` | `false` | Applies selected active highlight background and 3px green left border accent. |

### Events Dispatched

| Event Name | Bubbles | Composed | Detail Payload | Description |
| --- | --- | --- | --- | --- |
| `atoll-item-click` | `true` | `true` | `{ title: String, selected: Boolean }` | Dispatched on mouse click, touch tap, or keyboard `Enter`/`Space` triggers when interactive. |

---

## 3. Dynamic Computed Slots Architecture

To eliminate unneeded DOM node allocations and avoid manual `hidden` DOM attribute manipulation, `<atoll-list-item>` utilizes **Coralite Computed Slots** (`slots: { ... }`) to conditionally construct and render slot content:

```javascript
export default defineComponent({
  slots: {
    /**
     * Dynamic slot evaluation for unread count badge.
     */
    badge (originalNodes, state) {
      if (originalNodes && originalNodes.length > 0) return originalNodes
      if (!state.badge || state.badge === '0') return null
      return `<atoll-badge size="sm" count="${state.badge}"></atoll-badge>`
    },

    /**
     * Dynamic slot evaluation for navigation directional chevron.
     */
    chevron (originalNodes, state) {
      if (originalNodes && originalNodes.length > 0) return originalNodes
      if (!state.chevron) return null
      return `<span class="atoll-list-item-chevron"><atoll-icon name="chevron-right" size="18"></atoll-icon></span>`
    },

    /**
     * Dynamic slot evaluation for top-right timestamp.
     */
    timestamp (originalNodes, state) {
      if (originalNodes && originalNodes.length > 0) return originalNodes
      if (!state.timestamp) return null
      return `<span class="atoll-list-item-timestamp">${state.timestamp}</span>`
    },

    /**
     * Dynamic slot evaluation for item subtitle / description.
     */
    description (originalNodes, state) {
      if (originalNodes && originalNodes.length > 0) return originalNodes
      if (!state.description) return null
      const extraClass = state.unread ? ' fw-bold' : ''
      return `<small class="atoll-list-item-description text-truncate${extraClass}">${state.description}</small>`
    }
  }
})
```

---

## 4. Styling Architecture & Theme Variables (SCSS)

All styles reside in `src/scss/_atoll-list.scss`. The stylesheet maps layout tokens, spacing grids, transitions, and dark theme support using Atoll's custom prefix variables:

```css
--atoll-list-item-min-height-sm: 48px;
--atoll-list-item-min-height-md: 60px;
--atoll-list-item-min-height-lg: 72px;
--atoll-list-item-padding-x: 16px;
--atoll-list-item-padding-y: 10px;
```

---

## 4. Usage Patterns & Integration Examples

### 1. Simple Contact Item with Avatar
```html
<atoll-list divided="true">
  <atoll-list-item title="Brown" description="Away on business" clickable="true">
    <atoll-profile slot="left" src="/assets/avatars/brown.jpg" size="md"></atoll-profile>
  </atoll-list-item>
</atoll-list>
```

### 2. Settings Row with Leading Icon and Toggle Switch
```html
<atoll-list-item title="Mute Notifications" description="Pause sound and vibration alerts">
  <atoll-icon slot="left" name="volume-mute" size="20"></atoll-icon>
  <div slot="right">
    <input type="checkbox" class="form-check-input" role="switch" checked />
  </div>
</atoll-list-item>
```

### 3. Complex Custom Layout Projection
Passing raw, un-slotted child elements directly inside `<atoll-list-item>` projects them into the central content area, overriding the default title text:

```html
<atoll-list-item clickable="true">
  <atoll-profile slot="left" src="/assets/avatars/cony.jpg" size="md"></atoll-profile>
  
  <!-- Projects into default unnamed slot (Central Text Area) -->
  <div class="custom-center-layout">
    <strong class="text-primary">Cony (Verified)</strong>
    <span class="badge bg-warning ms-1">PRO</span>
  </div>
</atoll-list-item>
```
