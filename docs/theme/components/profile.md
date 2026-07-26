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
| **`multiparty`** | Circular frame split into 2, 3, or 4 image quadrants | Represents group chats (divides avatar area into equal segmented slices) |
| **`grouped`** | Row of overlapping individual profile circles | Displays member clusters in call bars or search results |

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

### Overlays & Indicators

1. **Ring Area (Story / Active Status):** Translucent or Brand Green gradient border ring around the avatar circle.
2. **Badge Area (Top-Right):** Notification dot, new story badge, or unread indicator.
3. **Icon Area (Bottom-Right):** Camera edit trigger, official verified checkmark, or online presence status dot.

---

## 2. Web Component API (`<atoll-profile>`)

The profile component is defined as a Coralite component with the following attribute API:

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `String` | `''` | The profile image source URL. Populated dynamically via client-side observation to prevent unhydrated template network failures. |
| `alt` | `String` | `'User profile'` | Alt text for accessibility. |
| `size` | `String` | `'md'` | Size scale: `'2xs'`, `'xs'`, `'sm'`, `'md'`, `'lg'`, `'xl'`, `'2xl'`, `'3xl'`. |
| `type` | `String` | `'single'` | Layout type: `'single'`, `'multiparty'`, `'grouped'`. |
| `badge` | `String` | `''` | Top-right badge count. |
| `icon-name` | `String` | `''` | Bottom-right overlay icon identifier. |
| `split-count` | `Number` | `1` | Target number of segments for multiparty grids (2, 3, or 4). |
| `ring` | `Boolean` | `false` | Enables active story/status gradient outline. |
| `has-error` | `Boolean` | `false` | Managed internally to toggle custom fallbacks if the image fails to load. |

---

## 3. Styling Modifiers (CSS/SCSS)

All styles reside in `src/scss/_atoll-profile.scss`. The stylesheet targets class modifiers on the inner elements to provide clean BEM-based structure and performance:

- `.atoll-profile`: Base host container setting dimension variables.
- `.atoll-profile-circle`: Handles circular layout cropping and background placeholders.
- `.atoll-profile-ring`: Renders the high-performance gradient status ring.
- `.atoll-profile-multiparty`: Converts the circular frame into vertically sliced/quadrant grids (`.atoll-profile-grid-2`, `.atoll-profile-grid-3`, `.atoll-profile-grid-4`).
- `.atoll-profile-group-row`: Enables overlapping layouts for group call rings and member grids.
- `.atoll-profile-badge`: Places badge counts at the absolute top-right quadrant.
- `.atoll-profile-icon`: Places utility and presence icons at the absolute bottom-right quadrant.

---

## 4. Usage Patterns & Examples

### 1. Standard Chat List Profile Avatar with Active Story Ring
```html
<atoll-profile 
  src="/assets/avatars/brown.jpg" 
  alt="Brown" 
  size="md" 
  ring="true"
></atoll-profile>
```

### 2. Friend List Profile with Online Badge & Camera Overlay Trigger
```html
<atoll-profile 
  src="/assets/avatars/cony.jpg" 
  alt="Cony" 
  size="lg" 
  icon-name="camera"
></atoll-profile>
```

### 3. Group Chat Multiparty Profile Avatar (4-Quadrant Split)
```html
<atoll-profile 
  type="multiparty" 
  split-count="4" 
  size="md" 
  alt="Design Team Group"
>
  <div slot="image">
    <img src="/assets/avatars/user1.jpg" alt="">
    <img src="/assets/avatars/user2.jpg" alt="">
    <img src="/assets/avatars/user3.jpg" alt="">
    <img src="/assets/avatars/user4.jpg" alt="">
  </div>
</atoll-profile>
```

### 4. Grouped Overlapping Member Profiles (Call Screen Bar)
```html
<div class="atoll-profile-group-row">
  <atoll-profile src="/assets/avatars/user1.jpg" size="sm"></atoll-profile>
  <atoll-profile src="/assets/avatars/user2.jpg" size="sm"></atoll-profile>
  <atoll-profile src="/assets/avatars/user3.jpg" size="sm"></atoll-profile>
</div>
```
