# Atoll Chat Badge Component Architecture (`atoll-badge`)

The badge specifications, the **Badge** component in Atoll Chat provides high-visibility status, unread message counts, and notification dots across avatars, chat list items, top navigation icons, and system tags.

---

## 1. The Design Foundations & Specification

Badges in Atoll Chat are categorized into three functional variants:

1. **Dot Badge** (Status / Dot)
2. **Numeric Count Badge** (Unread Message Count)
3. **Text / Tag Badge** (System Label)

### Sizing Scale & Geometry

Badges align directly to Atoll Chat's 4px/8px spatial grid and typography scale.

| Size Token | Type | Height / Dim | Min Width | Typography Scale | Primary Application |
| --- | --- | --- | --- | --- | --- |
| **`dot`** | Dot | **8px × 8px** | 8px | N/A | Avatar presence status, tab bar activity dot |
| **`sm`** | Count/Text | **16px** | 16px | `caption-2` (10px / W500) | Compact chat list unread counts, status tags |
| **`md` (Default)** | Count/Text | **20px** | 20px | `caption-1` (12px / W600) | Standard chat feed unread count, tab badges |
| **`lg`** | Count/Text | **24px** | 24px | `body-2` (14px / W600) | Hero profile notifications, overlay tags |

### Numeric Truncation Rules

To prevent unread count badges from breaking layout boundaries inside narrow list rows:

- **Default Threshold (`max-count`):** `99` (Displays `99+` when total exceeds 99).
- **Extended Threshold (`max-count="999"`):** `999` (Displays `999+` for system channels).
- **Zero Handling:** When count is `0` or `null`, the badge automatically hides (`display: none`) unless explicitly configured to remain visible via `show-zero`.

---

## 2. Web Component API (`<atoll-badge>`)

The badge component is defined as a Coralite component with the following attribute API:

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `count` | `Number` | `null` | The numeric unread count. |
| `max-count` | `Number` | `99` | The maximum unread count threshold before truncation. |
| `dot` | `Boolean` | `false` | Sets the badge to a simple dot status notifier. |
| `variant` | `String` | `'danger'` | Badge color variant: `'danger'`, `'primary'`, `'secondary'`, `'info'`. |
| `size` | `String` | `'md'` | Sizing scale: `'sm'`, `'md'`, `'lg'`. |
| `label` | `String` | `''` | Text/tag label mode (e.g. `"BOT"`, `"NEW"`). |
| `show-zero` | `Boolean` | `false` | If true, remains visible even if `count` is `0`. |

---

## 3. Styling Modifiers (CSS/SCSS)

All styles reside in `src/scss/_atoll-badge.scss`. The stylesheet targets class modifiers on the inner elements to provide clean BEM-based structure and performance:

- `.atoll-badge`: Base layout, alignment, and scale transition.
- `.atoll-badge-danger` (Default): Red background with white text.
- `.atoll-badge-primary`: Green background with white text.
- `.atoll-badge-secondary`: Gray background with dark-gray text.
- `.atoll-badge-info`: Blue background with white text.
- `.atoll-badge-dot`: Explicit 8px x 8px circular dot styling.
- `.atoll-badge-sm`: 16px height with compact paddings.
- `.atoll-badge-md`: 20px height standard padding.
- `.atoll-badge-lg`: 24px height spacious padding.

---

## 4. Usage Patterns & Examples

### 1. Unread Message Count in Chat List
```html
<!-- Standard Unread Badge (e.g. "5" or "99+") -->
<atoll-badge count="5"></atoll-badge>

<!-- High-Volume Channel Unread Badge (e.g. "999+") -->
<atoll-badge count="1420" max-count="999"></atoll-badge>
```

### 2. Notification Dot on Tab Bar or Icon
```html
<div class="atoll-badge-container">
  <atoll-icon name="bell" size="24"></atoll-icon>
  <atoll-badge dot="true" class="atoll-badge-positioned"></atoll-badge>
</div>
```

### 3. System Status Label / Text Tag
```html
<!-- Bot Identifier Tag -->
<atoll-badge label="BOT" variant="secondary" size="sm"></atoll-badge>

<!-- Feature Badge -->
<atoll-badge label="NEW" variant="primary" size="sm"></atoll-badge>
```
