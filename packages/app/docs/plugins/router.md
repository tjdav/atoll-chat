# Router Plugin (`router`)

### Import pattern

The `client.context` uses a Phase 1 async dynamic import to load
`../lib/router/index.js` into the browser bundle. This is required: static top-level
imports in the plugin file are not hoisted into the serialized client
bundle. See `docs/plugins/README.md` for the cross-cutting rule.

The `router` plugin provides lightweight, pure JS in-page routing for Atoll single-page applications by managing query parameters and subscriber notifications.

## 1. Overview

The router plugin manages current URL state, parses query parameters, provides URL push navigation without full page reloads, and notifies subscribed shell components (such as `rail-host`) when navigation events or `popstate` browser actions occur.

## 2. Contract

The plugin registers under the name `router`, making its surface available under `ctx.router` or destructured as `{ router }` in `client()` context functions.

### Surface Methods

* `getActiveRail(): string | null` — Returns the value of the `rail` query parameter, or `null` if absent.
* `getActiveDetail(): string | null` — Returns the value of the `detail` query parameter, or `null` if absent.
* `getSelection(): string | null` — Returns the value of the `id` query parameter, or `null` if absent.
* `getParams(): Record<string, string>` — Returns an object containing all current URL query parameters as string key-value pairs.
* `navigate(params: Record<string, string | null | undefined>): void` — Updates the query string via `history.pushState` and synchronously notifies subscribers. Omits `null` or `undefined` keys.
* `back(): void` — Calls `history.back()`. Subscriber notification occurs when the browser fires `popstate`.
* `subscribe(cb: () => void): () => void` — Registers a synchronous change listener. Returns an unsubscribe function.

## 3. URL Format

The router uses standard URL query parameters:
* `rail` — Active rail extension ID (e.g. `core.chat`, `core.media`).
* `detail` — Active detail surface route or view type (e.g. `chat`, `media-viewer`).
* `id` — Primary selection entity ID (e.g. room ID, call ID).
* Secondary parameters (e.g. `messageId`) are preserved in `getParams()`.

Example: `/app.html?rail=core.chat&detail=chat&id=r_123`

## 4. Component Pattern

A component consumes the router plugin in `client({ router, signal })`:

```javascript
import { defineComponent } from 'coralite'

export default defineComponent({
  client({ router, signal }) {
    function render() {
      const activeRail = router.getActiveRail()
      // Update DOM based on active route
    }

    render()

    const unsubscribe = router.subscribe(() => {
      render()
    })

    if (signal) {
      signal.addEventListener('abort', unsubscribe)
    }
  }
})
```

## 5. Server-Side Behavior

During SSR (server context), all `router` methods return safe default no-ops (`null` for active routes, `{}` for params, and no-op functions for navigation and subscriptions) so component rendering during build time does not throw.

## 6. Failure Modes

* **Calling `navigate` in getters:** Getters run during state computation; triggering side effects like `navigate` in a getter will throw or create infinite loops.
* **Unsubscribing:** Failing to store or invoke the function returned by `subscribe` when a component unmounts will lead to memory leaks or stale renders across unmounted instances. Pass `{ signal }` or clean up on abort.

## 7. What Is Not Implemented

* Surface rendering driven by `detail` routes (handled in C-CHAT-6).
* Route validation against registered extension permissions.
* Deep-link payload parsing for push notifications or invite links.
