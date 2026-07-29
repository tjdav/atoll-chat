# Atoll Profile Component Architecture (`atoll-profile`)

The **Profile** component in Atoll Chat represents individual users, group chats, or official channels across navigation bars, chat lists, active call overlays, and profile header cards.

---

## 1. Design Foundations & Specification

The profile component is configured as a single circular element supporting individual avatars, multi-party group splits, stacked group profiles, story/status rings, and contextual badges.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Profile Component Anatomy                       │
├────────────────────────────────────────────────────────────────────────┤
│                      [ 2. Ring Area (Story/Status) ]                   │
│               ┌────────────────────────────────────────┐               │
│               │                                  [3]   │               │
│               │        [ 1. Profile Circle ]  (Badge)  │               │
│               │               (Image)                  │               │
│               │   [4]                                  │               │
│               │ (Icon)                                 │               │
│               └────────────────────────────────────────┘               │
└────────────────────────────────────────────────────────────────────────┘
```

### Profile Layout Types

| Layout Type (`type="..."`) | Visual Geometry | Description / Application |
| --- | --- | --- |
| **`single` (Default)** | Single 100% circular crop | Represents an individual user or single official account |
| **`multiparty`** | Unified circular frame split into 2, 3, or 4 image quadrants | Represents group chats (divides avatar area into equal segmented slices strictly inside a single circle) |
| **`grouped`** | Horizontal row of overlapping individual profile circles | Displays member clusters in call bars or search results |

#### Multiparty Grid Specifications
- **Circular Mask:** Enforced strictly via `border-radius: 50%` and `overflow: hidden` on `.atoll-profile-circle`.
- **2-User Split (`multiparty-2`):** Circle split vertically down the middle into equal left and right halves (50% width, 100% height).
- **3-User Split (`multiparty-3`):** Left side is one large half-circle (50% width, 100% height, `grid-row: 1 / span 2`), right side is split horizontally into top-right and bottom-right quadrants.
- **4-User Split (`multiparty-4`):** Symmetrical 2x2 grid with 4 equal quadrants.
- **Internal Divider Lines:** Clean 1px grid gaps colored with `var(--atoll-profile-border-color, #ffffff)`.
- **Slotted Container Participation:** `slot[name="image"]` and `div[slot="image"]` use `display: contents` to participate directly in the CSS grid matrix.

#### Grouped Overlapping Stack Specifications
- **Horizontal Overlap:** Profiles inside `.atoll-profile-group-row` overlap horizontally with `margin-left: -14px`.
- **Left-to-Right Stacking Order (`z-index`):** A descending `@for` SCSS loop (`z-index: #{21 - $i}`) places the left-most profile on top (`z-index: 20`), with each subsequent profile tucked underneath the one before it.
- **Visual Cutout Ring:** Each profile circle in the stack features a 2px solid white border (`border: 2px solid var(--atoll-profile-border-color, #ffffff)`), preserving clean circular outlines.

---

### Standard Sizing Scale

Atoll defines **8 exact, strict profile sizes** tailored for specific UI contexts to maintain optical alignment across screens.

| Size Token | Diameter | Primary Application Context |
| --- | --- | --- |
| **`2xs`** | **30px** | Compact group chatroom title bar |
| **`xs`** | **32px** | Extra-small list items, inline mentions |
| **`sm`** | **42px** | Home tab lists, friend list items |
| **`md` (Default)** | **50px** | **Standard Chat List item avatars** |
| **`lg`** | **56px** | Notification list items, search highlights |
| **`xl`** | **60px** | Large list items, settings panel headers |
| **`2xl`** | **87px** | Active voice/video call screen profile cards |
| **`3xl`** | **95px** | Hero OpenChat header, profile detail views |

---

## 2. Web Component API (`<atoll-profile>`)

The profile component is defined as a Coralite component with the following attribute API:

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `String` | `''` | The profile image source URL. |
| `name` | `String` | `''` | User or channel display name, used for deterministic initials fallback. |
| `alt` | `String` | `'User profile'` | Alt text for accessibility. |
| `size` | `String` | `'md'` | Size scale: `'2xs'`, `'xs'`, `'sm'`, `'md'`, `'lg'`, `'xl'`, `'2xl'`, `'3xl'`. |
| `type` | `String` | `'single'` | Layout type: `'single'`, `'multiparty'`, `'grouped'`. |
| `badge` | `String` | `''` | Top-right badge count. |
| `icon-name` | `String` | `''` | Bottom-right overlay icon identifier. |
| `split-count` | `Number` | `1` | Target number of segments for multiparty grids (2, 3, or 4). |
| `ring` | `Boolean` | `false` | Enables active story/status gradient outline. |
| `has-error` | `Boolean` | `false` | Managed internally to toggle custom fallbacks if the image fails to load. |

---

## 3. Dynamic Computed Slots Architecture

To eliminate unneeded DOM node allocations, `<atoll-profile>` utilizes **Coralite Computed Slots** (`slots: { ... }`) to conditionally construct and render slot content:

```javascript
export default defineComponent({
  slots: {
    /**
     * Dynamic slot evaluation for profile badge.
     * @param {Node[]} originalNodes - Light DOM slotted elements.
     * @param {Object} state - Component state.
     * @returns {string|Node[]|null} Evaluated slot content.
     */
    badge (originalNodes, state) {
      if (!state.badge) {
        return null // Coralite automatically clears slot container DOM
      }
      if (originalNodes && originalNodes.length > 0) {
        return originalNodes // Render custom slotted Light-DOM element
      }
      return `<atoll-badge size="sm" count="${state.badge}"></atoll-badge>`
    },

    /**
     * Dynamic slot evaluation for overlay icon.
     * @param {Node[]} originalNodes - Light DOM slotted elements.
     * @param {Object} state - Component state.
     * @returns {string|Node[]|null} Evaluated slot content.
     */
    icon (originalNodes, state) {
      if (!state.iconName) {
        return null
      }
      if (originalNodes && originalNodes.length > 0) {
        return originalNodes
      }
      return `<atoll-icon name="${state.iconName}" size="${state.overlayIconSize}"></atoll-icon>`
    }
  }
})
```

### Reactive Slot Engine
- When `badge` or `iconName` attributes are empty (`''`), slot transformation functions return `null`. Coralite automatically empties the slot container (`slotEl.innerHTML = ''`).
- When `badge="5"` or `icon-name="camera"` mutates post-mount, Coralite's reactive slot observer re-evaluates `slots.badge` or `slots.icon` and dynamically instantiates `<atoll-badge>` or `<atoll-icon>`.

---

## 4. Styling Modifiers (CSS/SCSS)

All styles reside in `src/scss/_atoll-profile.scss`:

- `.atoll-profile`: Base host container setting strict size dimensions.
- `.atoll-profile-circle`: Circular outer container with `overflow: hidden` and `border-radius: 50%`.
- `.atoll-profile-ring`: High-performance status ring with gradient background.
- `.atoll-profile-multiparty`: Grid layout container supporting `.multiparty-2`, `.multiparty-3`, and `.multiparty-4` quadrant splits.
- `.atoll-profile-group-row`: Enables overlapping profile stacks (`margin-left: -14px`) with descending `z-index` stacking and 2px cutout borders.
- `.atoll-profile-badge`: Absolute positioning for top-right badges (`top: 0; right: 0; transform: translate(20%, -20%)`).
- `.atoll-profile-icon`: Absolute positioning for bottom-right overlay icons (`bottom: 0; right: 0; transform: translate(15%, 15%)`).

---

## 5. Usage Patterns & Examples

### 1. Standard Chat List Profile Avatar with Active Story Ring
```html
<atoll-profile 
  src="/assets/avatars/brown.jpg" 
  alt="Brown" 
  size="md" 
  ring="true"
></atoll-profile>
```

### 2. Profile Avatar with Dynamic Badge & Overlay Icon
```html
<atoll-profile 
  name="Cony" 
  size="lg" 
  badge="5"
  icon-name="camera"
></atoll-profile>
```

### 3. Group Chat Multiparty Profile Avatar (3-Quadrant Split)
```html
<atoll-profile 
  type="multiparty" 
  split-count="3" 
  size="xl" 
  alt="Design Team Group"
>
  <div slot="image">
    <img src="/assets/avatars/user1.jpg" alt="User 1">
    <img src="/assets/avatars/user2.jpg" alt="User 2">
    <img src="/assets/avatars/user3.jpg" alt="User 3">
  </div>
</atoll-profile>
```

### 4. Grouped Overlapping Member Profiles (Call Screen Bar)
```html
<div class="atoll-profile-group-row">
  <atoll-profile name="Alice Smith" size="lg"></atoll-profile>
  <atoll-profile name="Bob Jones" size="lg"></atoll-profile>
  <atoll-profile name="Charlie Brown" size="lg"></atoll-profile>
</div>
```
