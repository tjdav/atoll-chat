# Atoll List & Card Header Architecture (`atoll-list-header`)

The **List & Card Header** component in Atoll Chat serves as a unified section title for message threads, card headings in dashboard widgets, and interactive triggers for expandable accordion panels.

---

## 1. Design Foundations & Specification

A list header bridges section organization, filter drop-downs, card headers, and accordion expand/collapse triggers.

### Sizing Scale & Geometry

List headers align directly to Atoll Chat's 4px/8px spatial grid and typography scale.

| Size Token | Height / Dim | Typography Scale | Primary Application |
| --- | --- | --- | --- |
| **`sm`** | **36px** | `caption-1` (12px / W600) | Compact list sections, secondary headers |
| **`md` (Default)** | **44px** | `body-2` (14px / W600) | Standard chat list section dividers, list headers |
| **`lg`** | **52px** | `body-1` (16px / W600) | Hero views, main card headers, settings sections |

### Layout Contexts & Functional Variants

| Variant (`variant="..."`) | Layout Alignment | Trailing Action Defaults | UX Application |
| --- | --- | --- | --- |
| **`list` (Default)** | Flat layout, subtle bottom border/divider | Optional "See all" text button, icon button, or filter link | Primary section divider in chat lists ("Pinned Chats", "Friends") |
| **`card`** | Embedded inside card containers, flush padding | Card action menu (e.g., overflow `MoreTwo` icon) | Header for modular cards (Vault Summary, Call History Card) |
| **`accordion`** | Interactive trigger, cursor pointer | Rotating Chevron icon (`chevron-down` $\rightarrow$ $180^\circ$) | Expandable/collapsible list sections (e.g. "Archived (14)") |

### Title Area Features

* **Count Badge:** Displays numerical counts next to section titles (e.g., "Groups `12`").
* **Title Dropdown Filter (`dropdown="true"`):** Displays a subtle down arrow beside the title to indicate an interactive filter modal or sorting popover.
* **Subtitle Support:** Renders secondary helper text or metadata below the title.

---

## 2. Web Component API (`<atoll-list-header>`)

The list-header component is defined as a Coralite component with the following attribute API:

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `String` | `''` | The primary header title text. |
| `subtitle` | `String` | `''` | Secondary helper text or metadata below the title. |
| `variant` | `String` | `'list'` | Layout context modifier: `'list'`, `'card'`, or `'accordion'`. |
| `size` | `String` | `'md'` | Sizing scale: `'sm'`, `'md'`, `'lg'`. |
| `badge` | `String` | `''` | Optional unread or total count number. |
| `action-text` | `String` | `''` | Text label for a secondary action button. |
| `dropdown` | `Boolean` | `false` | Sets a downward arrow beside the title indicating interactive dropdown sort/filter. |
| `expanded` | `Boolean` | `false` | Specifies whether the accordion variant is expanded. |
| `collapsible` | `Boolean` | `false` | Sets standard list sections to act as expandable interactive triggers (behaves like an accordion). |

### Custom Events

| Event Name | Detail Payload | Description |
| --- | --- | --- |
| `atoll-header-toggle` | `{ expanded: Boolean }` | Dispatched when the accordion is clicked or toggled via keyboard interaction. |

---

## 3. Styling Modifiers (CSS/SCSS)

All styles reside in `src/scss/_atoll-list-header.scss`. The stylesheet targets class modifiers on the inner elements to provide clean BEM-based structure and performance:

- `.atoll-list-header`: Base container style and flex alignment.
- `.atoll-list-header-list`: Flat layout with a subtle bottom divider.
- `.atoll-list-header-card`: Embedded layout with standard padding, rounded top corners, and a border.
- `.atoll-list-header-accordion`: Interactive cursor trigger, hover backgrounds, and CSS chevron transitions.
- `.atoll-list-header-sm`: Tight padding with small typography scale.
- `.atoll-list-header-lg`: Spacious padding with large typography scale.

---

## 4. Usage Patterns & Examples

### 1. Standard List Section Divider with Action Text Button
```html
<atoll-list-header 
  title="Pinned Chats" 
  badge="3" 
  action-text="Edit"
></atoll-list-header>
```

### 2. Card Header with Overflow Action Slot
```html
<div class="card">
  <atoll-list-header 
    variant="card" 
    title="Security & Vault" 
    subtitle="Encrypted session keys"
  >
    <atoll-button slot="action" icon-only="true" variant="ghost" size="sm" aria-label="Card Options">
      <atoll-icon name="more" size="20"></atoll-icon>
    </atoll-button>
  </atoll-list-header>

  <div class="card-body">
    <!-- Card content -->
  </div>
</div>
```

### 3. Interactive Accordion Header Trigger
```html
<atoll-list-header 
  variant="accordion" 
  title="Archived Conversations" 
  badge="14" 
  expanded="false"
></atoll-list-header>
```

### 4. Dropdown Sorting Filter Header
```html
<atoll-list-header 
  title="Recent Contacts" 
  dropdown="true" 
  subtitle="Sorted by active status"
></atoll-list-header>
```
