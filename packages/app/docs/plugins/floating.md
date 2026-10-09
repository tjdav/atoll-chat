# Floating UI Positioning Plugin (`ctx.floating`)

This guide describes how to use the `floating` plugin for positioning popovers, context menus, tooltips, and dropdowns using Floating UI.

## 1. Overview

The `floating` plugin integrates `@floating-ui/dom` into `@atoll/app`. It loads Floating UI once during application boot and exposes positioning primitives (`positionFloating` and `virtualElementFromPoint`) directly on `ctx.floating` across all client application components.

## 2. Why a Plugin, Not a Library Import

Dynamic `import('@floating-ui/dom')` calls inside a component's `client()` block load the library lazily on first use. For user-triggered popovers like context menus, this pauses the action while the chunk fetches, causing visible delay on cold cache at the exact moment the user expects an immediate response.

By integrating Floating UI as a Coralite plugin:
- Coralite invokes `client.context` Phase 1 during application boot.
- `@floating-ui/dom` is dynamically imported in parallel with other boot tasks.
- When any component opens a popover, the positioning API is already resolved in memory—ensuring zero fetch latency and instant visual rendering.

## 3. The `ctx.floating` Contract

The plugin exposes two top-level methods directly under `ctx.floating`:
- `positionFloating({ reference, floating, placement, strategy, offsetPx, padding }, signal)`
- `virtualElementFromPoint(x, y)`

Keys are exposed directly under `ctx.floating`. There is no nested wrapper object (e.g. `ctx.floating.floating` is invalid).

## 4. The `positionFloating` API

```javascript
const cleanup = ctx.floating.positionFloating({
  reference,   // HTMLElement | VirtualElement
  floating,    // HTMLElement
  placement,   // string (optional, default 'bottom-start')
  offsetPx,    // number (optional, default 6)
  padding      // number (optional, default 8)
}, signal)     // AbortSignal (optional)
```

### Parameters
- `params` (`object`): Positioning parameters object.
  - `reference` (`Element` | `object`): The anchor element (real DOM node or virtual element object with `getBoundingClientRect()`).
  - `floating` (`HTMLElement`): The floating element to be positioned (must have `position: fixed` in CSS).
  - `placement` (`string`, optional): Preferred placement (e.g., `'bottom-start'`, `'top'`, `'right-end'`). Defaults to `'bottom-start'`.
  - `offsetPx` (`number`, optional): Pixel distance between the reference and floating elements. Defaults to `6`.
  - `padding` (`number`, optional): Minimum pixel padding from viewport edges. Defaults to `8`.
- `signal` (`AbortSignal`, optional): Component lifecycle signal from `client()` context.

### Behavior
- Computes position using `strategy: 'fixed'` with `offset`, `flip`, and `shift` middleware.
- Immediately applies computed `left` and `top` inline CSS values to `floating`.
- Starts `autoUpdate` tracking for scroll, resize, and layout shifts.
- Returns a synchronous, idempotent `cleanup()` function to stop `autoUpdate` listeners.

### Signal-based cleanup
- The function accepts an optional `AbortSignal` as its second positional argument.
- When the signal is provided, `positionFloating` registers its own abort listener (`signal.addEventListener('abort', cleanup, { once: true })`). Callers do not need to manage manual abort listeners for positioning.
- When the signal aborts, the autoUpdate cleanup runs automatically and unregisters the event listener. The cleanup becomes a no-op for future invocations.
- When the signal is already aborted at call time, `positionFloating` short-circuits. It does not set up `computePosition` or `autoUpdate` and returns a no-op cleanup.
- The returned cleanup is idempotent. Callers may invoke it on their own (e.g. when an `open` attribute toggles to `false`) and the signal will invoke it on disconnect; the second invocation has no effect.
- **Recommended pattern:** pass the component's `signal` from the `client()` context as the second argument. The plugin handles teardown on unmount.

## 5. The `virtualElementFromPoint` API

```javascript
const virtualEl = ctx.floating.virtualElementFromPoint(x, y)
```

### Parameters
- `x` (`number`): Viewport X coordinate.
- `y` (`number`): Viewport Y coordinate.

### Return Value
Returns an object conforming to Floating UI's `VirtualElement` contract:
```javascript
{
  getBoundingClientRect() {
    return { x, y, top: y, left: x, right: x, bottom: y, width: 0, height: 0 }
  }
}
```

Use `virtualElementFromPoint` when anchoring popovers to arbitrary point coordinates (e.g. `contextmenu` click events or long-press touch positions) rather than physical DOM elements.

## 6. Integration in a Coralite Component

Components consume `ctx.floating` inside `client()`. See `packages/app/src/components/composed/message-context-menu.html` for canonical implementation:

```html
<script type="module">
import { defineComponent } from 'coralite'

export default defineComponent({
  attributes: {
    open: { type: Boolean, default: false, reflect: true }
  },

  client({ state, refs, floating, observe, signal }) {
    const menu = refs('menu')
    let cleanup = null

    function applyPosition() {
      if (cleanup) {
        cleanup()
        cleanup = null
      }
      if (!state.open) return
      if (typeof menu.getAnchor !== 'function') return
      const anchor = menu.getAnchor()
      if (!anchor) return

      cleanup = floating.positionFloating({
        reference: anchor,
        floating: menu,
        placement: 'bottom-start',
        offsetPx: 6,
        padding: 8
      }, signal)
    }

    observe('open', () => {
      applyPosition()
    })
  }
})
</script>
```

The trigger surface passes the anchor before opening:
```javascript
contextMenuEl.getAnchor = () => floating.virtualElementFromPoint(x, y)
```

## 7. Server Context

SSR environments (Node.js) lack DOM APIs (`window`, `getBoundingClientRect`, `Element`). The server context stub exposes `positionFloating` and `virtualElementFromPoint`, both of which throw an error when invoked:

```
Error: floating.positionFloating is not available during SSR. Positioning is client-only.
```

Popover positioning must be performed exclusively in client-side lifecycle callbacks (`client()`, observers, or event handlers).

## 8. Failure Modes

| Failure Mode | Root Cause | Symptom | Resolution |
|---|---|---|---|
| Popover position is stuck after scroll/resize | Holding the cleanup function and forgetting to invoke it on `open = false` | Memory leak & outdated element position | Call `cleanup()` when `open` becomes `false` in `observe('open')` |
| Redundant abort handling | Registering a manual `signal.addEventListener('abort', ...)` for positioning | Unnecessary boilerplate & potential listener leaks | Pass `signal` directly as second argument to `positionFloating` |
| Popover renders at `0,0` | `getAnchor()` returns `undefined` or null | Menu floats at top-left corner | Ensure parent sets `getAnchor()` on the component before `open` becomes `true` |
| Coordinates mismatch with mouse | CSS `.menu` uses `position: absolute` instead of `fixed` | Position misaligned on scrolled pages | Ensure floating element CSS uses `position: fixed` |

## 9. Adding a New Popover Surface

To adopt `ctx.floating` on a new surface (e.g. tooltip or dropdown):

1. Ensure the floating DOM element has `position: fixed` in CSS.
2. In the component's `client()`, destructure `floating` and `signal`.
3. In `observe('open')`, invoke `floating.positionFloating({ reference: anchor, floating: el }, signal)` when `open` is true, and invoke `cleanup()` when `open` is false.
