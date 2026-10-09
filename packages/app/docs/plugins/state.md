# Global State Store Plugin — `globalStore`

> **Component prerequisite:** Every component must wrap its export in `defineComponent` from `'coralite'`. See [i18n.md](./i18n.md) for the pattern and enforcement tests.

The `globalStore` plugin provides single-tab reactive shell state management across components in `@atoll/app`.

---

## 1. Overview

The state plugin is exposed to components as `globalStore`. It wraps a Proxy-backed store created via `createStateStore()` from `src/lib/state/index.js`. The store provides cross-component reactive state sharing without prop-drilling or custom event dispatching.

---

## 2. The `$state` Object

The `$state` property is a reactive Proxy over global shell properties.

### Reading and Writing

```javascript
// Reading state
const currentUser = globalStore.$state.currentUser

// Writing state
globalStore.$state.selectedRoomId = 'r_123'
```

### Deleting Keys

```javascript
delete globalStore.$state['item:123']
```

### `DEFAULT_SHELL_STATE` Keys

The default state shape includes:
- `currentUser`: Current authenticated user object (`null` if signed out).
- `isAuthenticated`: Boolean indicating session authentication status.
- `oprfToken`: OPRF session token.
- `capabilities`: Server capabilities response object.
- `rooms`: Map of active room metadata.
- `roomOrder`: Array of room IDs specifying sidebar ordering.
- `selectedRoomId`: Currently selected room ID.
- `unreadCounts`: Map of room IDs to unread message counts.
- `activeCall`: Active call state object.
- `callHistory`: Array of recent call records.
- `readAloudMode`: Boolean indicating screen reader / read-aloud toggle.
- `readAloudState`: Current read-aloud playback state.
- `settings`: Client preferences and configuration settings.
- `ui`: UI flags (`{ activeRail, modal, toasts, offline }`).
- `pendingScrollToMessage`: Target message ID for post-load scroll.
- `storageReady`: Boolean set when SQLite storage initialization completes.
- `storagePersistent`: Boolean indicating if storage persistence (e.g. OPFS) is active.

---

## 3. The Subscription API

Components subscribe to key-level mutations via `globalStore.subscribe(key, cb, { signal })`.

```javascript
const unsubscribe = globalStore.subscribe('selectedRoomId', (newValue, oldValue) => {
  console.log(`Room changed from ${oldValue} to ${newValue}`)
}, { signal })
```

### Callback Signatures

- `subscribe(key, cb, { signal })`: `cb(newValue, oldValue)` receives the new value and prior value for the specified key.
- `subscribeAny(cb, { signal })`: `cb(null, newValue, oldValue)` passes `null` as the first key parameter in the current implementation.

### Unsubscribe Semantics and `{ signal }`

`subscribe` returns an explicit `unsubscribe()` function. Passing `{ signal }` automatically detaches the listener when the host component or `AbortController` aborts.

---

## 4. Component Pattern (Producer / Consumer)

### Producer Component

One component updates or sets state keys:

```javascript
export default defineComponent({
  client({ globalStore }) {
    // Write per-item state key (Task C-V-I state-key pattern)
    globalStore.$state['item:msg_456'] = { id: 'msg_456', text: 'Hello' }
  }
})
```

### Consumer Component

Another component reads and subscribes to state updates:

```javascript
export default defineComponent({
  client({ globalStore, signal }) {
    const msgId = 'msg_456'

    // Initial read
    const current = globalStore.$state['item:' + msgId]

    // Subscribe to changes
    globalStore.subscribe('item:' + msgId, (newValue) => {
      // Re-render item view
    }, { signal })
  }
})
```

---

## 5. Shallow Reactivity

`$state` provides top-level property reactivity only. Mutating nested object properties directly will **not** trigger key subscribers:

```javascript
// SILENT NO-OP: Does NOT fire 'ui' subscribers!
globalStore.$state.ui.activeRail = 'settings'

// CORRECT: Reassign the top-level property to trigger subscribers
globalStore.$state.ui = { ...globalStore.$state.ui, activeRail: 'settings' }
```

---

## 6. Deleting Keys

Invoking `delete $state[key]` fires the subscriber for that key with `undefined` as `newValue` and the former value as `oldValue`:

```javascript
delete globalStore.$state['item:msg_456']
```

Use `delete` when reloading lists or unmounting detailed views to purge stale keys and notify subscribers.

---

## 7. What Lives Where

- **`$state` (In-Memory)**: Global shell flags, ephemeral UI selections, active call handles, and view-model references. Discarded on page refresh.
- **SQLite Database**: Persistent domain entities (messages, rooms, members, preferences, drafts, reactions, sync sequence state).
- **Pattern**: SQLite is the source of truth. `$state` exposes reactive, readable views into runtime memory for components.

---

## 8. Failure Modes

1. **Writing from a getter**: Component getters in Coralite are pure computed properties. Mutating `$state` inside getters causes re-render loops or unexpected side effects.
2. **Subscribing without `{ signal }`**: Omitting `{ signal }` when calling `subscribe()` in a component `client()` block leaks memory listeners after component unmount.
3. **Assuming deep reactivity**: Direct property mutation on nested objects/arrays (`$state.rooms['r_1'].name = 'X'`) fails silently without notifying subscribers.

---

## 9. What is Not Implemented

- **Extension-Local State**: Extension-scoped `ctx.state` is isolated within individual extensions.
- **`subscribeAny` key argument**: `subscribeAny` currently delivers `null` as the key parameter to callbacks.
- **Cross-Tab Synchronization**: State mutations are scoped to the current browser tab window.

---

## 10. Server Context

During SSR / Server Rendering, `globalStore` context is a no-op fallback:

- `$state` evaluates as a plain JavaScript object `{}` without Proxy traps.
- `subscribe()` and `subscribeAny()` return no-op functions `() => {}`.
- `getSnapshot()` returns `{}`.
- `reset()` is a no-op function.

State reactivity is strictly client-side.
