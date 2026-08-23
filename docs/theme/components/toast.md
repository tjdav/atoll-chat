# Atoll Toast Architecture (`atoll-toast`)

Built natively on the **HTML Popover API** (`popover="manual"`), `<atoll-toast>` provides modern, zero-dependency toast notification management. It features a top-layer stack manager (up to 3 simultaneous toasts), 60fps GPU-composited enter/exit transitions, animated countdown progress bars, interactive action buttons, and complete WCAG 2.1/2.2 AA live-region compliance.

---

## 1. Design Foundations & Anatomy

Atoll toasts are lightweight notification overlays positioned in the Top Layer of the viewport.

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Toast Card Anatomy                            │
├────────────────────────────────────────────────────────────────────────┤
│  [ Variant Icon ]  [ Notification Message ]  [ Action ]  [ Dismiss ✕ ] │
│  ====================================================================  │
│                   [ Animated Countdown Progress Bar ]                  │
└────────────────────────────────────────────────────────────────────────┘
```

### Functional Variants

| Variant (`variant="..."` or `type="..."`) | ARIA Role | ARIA Live Region | Icon | Application |
| --- | --- | --- | --- | --- |
| **`success`** | `role="status"` | `aria-live="polite"` | `check-circle` | Confirmation of successful actions (e.g. copied link, saved profile) |
| **`danger`** | `role="alert"` | `aria-live="assertive"` | `alert-circle` | Critical system or network errors, failed operations |
| **`warning`** | `role="alert"` | `aria-live="assertive"` | `alert-triangle` | Cautionary alerts, rate limits, connection loss warnings |
| **`info` / `primary` (Default)** | `role="status"` | `aria-live="polite"` | `info` | General informational updates |
| **`secondary`** | `role="status"` | `aria-live="polite"` | `info` | Neutral background updates |

---

## 2. Web Component API (`<atoll-toast>`)

The toast component is defined as a Coralite component with the following attribute API:

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `placement` | `String` | `'bottom-start'` | Viewport anchor: `'bottom-start'`, `'bottom-center'`, `'bottom-end'`, `'top-center'`, `'top-end'`. |
| `max-toasts` | `Number` | `3` | Maximum number of simultaneous active toasts in the stack before oldest eviction. |
| `duration` | `String` / `Number` | `4000` | Default auto-dismiss timeout in milliseconds (set to `0` for persistent toasts). |

### Programmatic Host Methods

| Method Signature | Return Type | Description |
| --- | --- | --- |
| `show(options)` | `string` / `number` | Displays a toast notification and returns its unique ID. Accepts string message or object payload. |
| `toast(options)` | `string` / `number` | Alias for `show(options)`. |
| `hide(id)` | `void` | Dismisses a specific toast card by ID with a 150ms exit transition. |
| `clear()` | `void` | Instantly removes all active toasts from the stack and closes popover container. |

### EventBus Payload (`ui:show_toast`)

Toasts are triggered across the application using EventBus:

```javascript
$bus.emit('ui:show_toast', {
  message: 'Settings updated successfully',
  variant: 'success', // or type: 'success'
  duration: 4000,
  action: {
    label: 'Undo',
    onClick: (toast) => { /* Action callback */ }
  }
})
```

---

## 3. Keyboard & Accessibility (WCAG 2.2 AA)

- **Timing Adjustable (WCAG 2.2.1)**: Hovering (`mouseenter`) or focusing (`focusin`) any toast card automatically pauses its auto-dismiss countdown timer and progress bar animation. Moving away (`mouseleave`/`focusout`) resumes the timer.
- **Top Layer Placement**: Native HTML Popover API (`popover="manual"`) mounts toasts in the browser's top layer above all z-index stacking contexts.
- **Live Regions**: Non-critical notifications use `role="status"` and `aria-live="polite"`; critical errors use `role="alert"` and `aria-live="assertive"`.
- **Keyboard Navigation**: Pressing `Escape` while focused in the popover container dismisses the newest active toast card.

---

## 4. Usage Patterns & Integration Examples

### 1. Simple Notification via EventBus
```javascript
$bus.emit('ui:show_toast', {
  message: 'Link copied to clipboard!',
  variant: 'success'
})
```

### 2. Error Notification with Custom Duration
```javascript
$bus.emit('ui:show_toast', {
  message: 'Failed to connect to server. Retrying...',
  variant: 'danger',
  duration: 6000
})
```

### 3. Interactive Action Toast
```javascript
$bus.emit('ui:show_toast', {
  message: 'Message deleted',
  variant: 'info',
  duration: 5000,
  action: {
    label: 'Undo',
    onClick: () => {
      restoreDeletedMessage()
    }
  }
})
```
