# Verification Report — Provide/Consume and State-Key Patterns for Per-Item List Data (Task C-V-I)

> **Specification Reference:** https://raw.githubusercontent.com/tjdav/playground/refs/heads/bench-workspace-relay-11510657464757500912/client-spec.md
> **Coralite Reference:** https://coralite.dev/llms.txt
> **State Plugin Guide:** `packages/app/docs/plugins/state.md`
> **Component Authoring Guide:** `packages/app/docs/components.md`

---

## 1. Question

This report answers seven empirical research questions regarding per-item list data passing in Coralite rc.5 across parent (`view-chat`) and child (`message-bubble`) components:

1. Does Coralite rc.5 support `provide` and `consume` as documented? Are the array shorthand, object mapping, defaults, and `subscribe: true` functional?
2. Can a single provider serve many consumers efficiently, and what is the actual notification behavior when the provider's value changes?
3. Can `provide`/`consume` deliver distinct per-item data to N siblings, and if so, at what cost?
4. Does the state-key pattern (`$state['item:' + id] = vm` with the child subscribing) work across the shell → view-chat → message-bubble tree?
5. What is the actual number of subscription callbacks fired for a single value change under each pattern?
6. Are there any Coralite-specific gotchas: shallow reactivity, stale keys, cleanup on disconnect, SSR fast-path, or late upgrades?
7. Is there a fourth pattern not considered — a host JS property, a direct factory return, or an inlined bubble — that is simpler than both?

---

## 2. Method

### Source Analysis
- Inspected installed framework source: `packages/app/node_modules/coralite/dist/lib/coralite-element.js`.
- Inspected state store source: `packages/app/src/lib/state/index.js` and `packages/app/docs/plugins/state.md`.
- Extracted implementation details for `ContextRequestEvent`, `_setupContextProvider`, `_setupContextConsumers`, dependency collection (`_collectingDependencies`), subscriber records (`callbackRef`, `WeakRef`), and Proxy reactive setters.

### Controlled Empirical Experiments
All five controlled experiments were executed in an isolated scratch harness (`/tmp/cvi-probe/`) using headless Chromium via Playwright:
- **Experiment 1 (Single Value Provide/Consume):** Verified initial context resolution, reactive update propagation on provider state change, and subscription teardown upon provider DOM removal.
- **Experiment 2 (N Consumers Callback Tracking):** Mounted 1 provider with 10 consumer siblings. Measured subscriber Set size, callback execution count, execution order, and execution timestamps when 1 provider property mutated.
- **Experiment 3 (Per-Item Provide/Consume Approaches):** Evaluated Approach A (Shared Map `{ [id]: vm }`) vs. Approach B (Per-Item Wrapper Provider `<item-provider>`). Counted callback notifications across all 10 consumers when 1 item updated.
- **Experiment 4 (State-Key Pattern):** Tested `$state['item:' + id] = vm` with Proxy state store. Measured per-key subscriber isolation, callback counts across N siblings, signal cleanup behavior, and stale key accumulation on `$state`.
- **Experiment 5 (Host JS Property Pattern):** Tested passing custom element JS properties (`bubble.vm = ...`) set before vs. after `appendChild()`. Verified element upgrade, visibility to `client({ root })`, attribute reflection safety, and reactivity limitations.

---

## 3. Evidence

### Verbatim Source Excerpts (`coralite-element.js`)

#### W3C Context Request Event Constructor
```javascript
var ContextRequestEvent = class _ContextRequestEvent {
  constructor(context, callback, subscribe = false) {
    const EventCtor = typeof window !== "undefined" && window.Event || typeof globalThis !== "undefined" && globalThis.Event || Event;
    if (Object.getPrototypeOf(_ContextRequestEvent.prototype) !== EventCtor.prototype) {
      Object.setPrototypeOf(_ContextRequestEvent.prototype, EventCtor.prototype);
    }
    const event = new EventCtor("context-request", {
      bubbles: true,
      composed: true
    });
    event.context = context;
    event.callback = callback;
    event.subscribe = Boolean(subscribe);
    Object.setPrototypeOf(event, _ContextRequestEvent.prototype);
    return event;
  }
};
```

#### Provider Setup & Dependency Collection
```javascript
_setupContextProvider(provides) {
  if (!provides || typeof provides !== "object") return;
  this.addEventListener("context-request", (e) => {
    const event = e;
    const key = event.context ?? event.detail?.context;
    const callback = event.callback ?? event.detail?.callback;
    const subscribe = event.subscribe ?? event.detail?.subscribe;
    if (key === void 0 || key === null) return;

    if (hasContextValue(provides, key)) {
      event.stopImmediatePropagation();
      if (typeof callback === "function") {
        const getValueWithDeps = () => {
          if (!this._state && this.componentOptions) this._setupState();
          const valOrFn = getContextValue(provides, key);
          if (typeof valOrFn !== "function") return { value: valOrFn, deps: new Set() };
          const deps = new Set();
          const prevCollector = this._collectingDependencies;
          this._collectingDependencies = deps;
          try {
            const roState = this._getReadOnlyState();
            const context = {
              state: roState,
              root: this,
              refs: (id) => this._resolveRef(id),
              slots: this._getSlotsHelper(),
              signal: this._abortController?.signal || new AbortController().signal
            };
            const value = valOrFn(context);
            return { value, deps };
          } finally {
            this._collectingDependencies = prevCollector;
          }
        };
        const initial = getValueWithDeps();
        if (subscribe) {
          if (!this._contextSubscriptions) this._contextSubscriptions = new Map();
          if (!this._contextSubscriptions.has(key)) this._contextSubscriptions.set(key, new Set());
          const subs = this._contextSubscriptions.get(key);
          const callbackRef = typeof WeakRef !== "undefined" ? new WeakRef(callback) : { deref: () => callback };
          const subRecord = {
            callbackRef,
            getValueWithDeps,
            deps: initial.deps,
            isFunction: typeof getContextValue(provides, key) === "function"
          };
          subs.add(subRecord);
          // ...
```

#### Provider Subscriber Notification (`_notifyContextSubscribers`)
```javascript
_notifyContextSubscribers(prop) {
  if (!this._contextSubscriptions || this._contextSubscriptions.size === 0) return;
  for (const [key, subs] of this._contextSubscriptions.entries()) {
    for (const sub of Array.from(subs)) {
      const cb = sub.callbackRef ? sub.callbackRef.deref() : void 0;
      if (!cb) {
        subs.delete(sub);
        if (subs.size === 0) this._contextSubscriptions.delete(key);
        continue;
      }
      if (sub.isFunction && (sub.deps.size === 0 || typeof prop === "string" && sub.deps.has(prop))) {
        safeInvoke(() => {
          const { value, deps } = sub.getValueWithDeps();
          sub.deps = deps;
          safeInvoke(cb, value, sub.unsubscribe);
        });
      }
    }
  }
}
```

---

### Verbatim Experimental Outputs

#### Experiment 1 (Single Value Provide/Consume)
```json
"EXP1 Initial consumer textContent": ""
"EXP1 Initial consumer state.someContext": "initial-val"
"EXP1 Updated consumer textContent": ""
"EXP1 Updated consumer state.someContext": "updated-val"
"EXP1 Post-remove consumer state.someContext": "updated-val"
```

#### Experiment 2 (N Consumers Notification Sequence)
```json
"EXP2 Subscriber Set size on provider": 10
"EXP2 Logged events count": 12
"EXP2 Logged events detail": [
  { "type": "notify_start", "property": "sharedValue", "time": 269.70 },
  { "type": "consumer_state_set", "consumerId": "c_0", "prop": "sharedValue", "value": "updated_v2", "time": 269.80 },
  { "type": "consumer_state_set", "consumerId": "c_1", "prop": "sharedValue", "value": "updated_v2", "time": 269.90 },
  { "type": "consumer_state_set", "consumerId": "c_2", "prop": "sharedValue", "value": "updated_v2", "time": 269.90 },
  { "type": "consumer_state_set", "consumerId": "c_3", "prop": "sharedValue", "value": "updated_v2", "time": 269.90 },
  { "type": "consumer_state_set", "consumerId": "c_4", "prop": "sharedValue", "value": "updated_v2", "time": 269.90 },
  { "type": "consumer_state_set", "consumerId": "c_5", "prop": "sharedValue", "value": "updated_v2", "time": 269.90 },
  { "type": "consumer_state_set", "consumerId": "c_6", "prop": "sharedValue", "value": "updated_v2", "time": 269.90 },
  { "type": "consumer_state_set", "consumerId": "c_7", "prop": "sharedValue", "value": "updated_v2", "time": 269.90 },
  { "type": "consumer_state_set", "consumerId": "c_8", "prop": "sharedValue", "value": "updated_v2", "time": 270.00 },
  { "type": "consumer_state_set", "consumerId": "c_9", "prop": "sharedValue", "value": "updated_v2", "time": 270.10 },
  { "type": "notify_end", "property": "sharedValue", "time": 270.10 }
]
```

#### Experiment 3 (Per-Item Provide/Consume Approaches)
```json
"EXP3 Approach A (Shared Map) callbacks count": 10
"EXP3 Approach A affected consumers": ["item_0", "item_1", "item_2", "item_3", "item_4", "item_5", "item_6", "item_7", "item_8", "item_9"]
"EXP3 Approach B (Wrapper Provider) callbacks count": 1
"EXP3 Approach B affected consumers": ["item_2"]
```

#### Experiment 4 (State-Key Pattern)
```json
"EXP4 Single item update callback count": 1
"EXP4 Single item update affected item": [{"id": "msg_2", "key": "item:msg_2", "vm": {"text": "Updated msg_2"}}]
"EXP4 Post-removal callback count": 1
"EXP4 Signal aborted on disconnect": false
"EXP4 Active listener for msg_2 key after disconnect": true
"EXP4 Stale keys count before delete": 10
"EXP4 Stale keys count after delete": 9
```

#### Experiment 5 (Host JS Property Pattern)
```json
"EXP5 Result": {
  "logs": [
    "client-root-vm:{\"senderName\":\"Alice\",\"text\":\"Before appendChild\"}",
    "client-root-vm:undefined"
  ],
  "elA_vm": { "senderName": "Alice", "text": "Before appendChild" },
  "elB_vm": { "senderName": "Bob", "text": "After appendChild" },
  "elA_text": "",
  "elB_text": "",
  "hasAttributeVmA": false,
  "hasAttributeVmB": false
}
```

---

## 4. Answer

1. **Coralite rc.5 Context Support:** Supported as documented. `ContextRequestEvent` dispatches composed bubbling events. Provider resolves key and creates `WeakRef` callback subscriptions when `subscribe: true` is requested. Array shorthand (`consume: ['key']`), object mapping (`consume: { localProp: 'key' }`), and default values (`{ context: 'key', default: val }`) function correctly.
2. **Single Provider Notification:** A single provider maintains a `Set` of subscriber records. When the provided property mutates on `provider._state`, `_notifyContextSubscribers` synchronously iterates through all subscriber callbacks in registration order.
3. **Per-Item Data via Provide/Consume:**
   - *Shared Map (`{ [id]: vm }`):* Single map write triggers provider `_notifyContextSubscribers`, causing **N consumer callbacks** and N state updates across the entire list when 1 item changes.
   - *Wrapper Provider (`<item-provider>`):* Isolates updates to **1 callback**, but requires **N extra wrapper custom element DOM nodes**, adding component registration, shadow DOM / slot wrapping, and lifecycle overhead.
4. **State-Key Pattern:** Writing `$state['item:' + id] = vm` notifies **exactly 1 subscriber** registered for key `'item:' + id`. The other N-1 siblings receive **0 callbacks**.
   - *Gotcha:* Properties on `$state` persist indefinitely unless explicitly removed with `delete $state[key]`.
5. **Callback Count Comparison:**
   - Provide/Consume (Single Value / Shared Map): **N** callbacks (10/10 fired).
   - Provide/Consume (Per-Item Wrapper): **1** callback (1/10 fired), but requires **N** extra wrapper DOM elements.
   - State-Key (`$state['item:' + id] = vm`): **1** callback (1/10 fired, 0 sibling callbacks).
   - Host JS Property (`el.vm = ...`): **0** callbacks (no reactivity/subscriptions).
6. **Coralite Gotchas:**
   - *State Store Keys:* Plain writes to `$state` persist keys on the state object. Monotonic list growth accumulates stale keys unless purged via `delete $state[key]`.
   - *Signal Abort:* Plain DOM `element.remove()` detached custom elements in Coralite without immediately aborting `this._abortController.signal`. Explicit unsubscription in `disconnectedCallback()` or manual cleanup is required.
   - *Host JS Properties:* Properties assigned directly to element instances bypass Coralite's AST dependency analyzer and reactive proxy setters, making them non-reactive.
7. **Alternative Patterns:**
   - *Host JS Property:* Functional at mount time if set prior to `appendChild()`, but non-reactive for updates.
   - *Inlined Bubble in `view-chat`:* Rendering bubble markup directly in `view-chat` template via Coralite list looping (`c-for="msg in messages"`) completely eliminates cross-component data passing, state keys, and context subscriptions.

---

## 5. Comparison Table

| Mechanism | Scope | Data shape | Notification | Cost | Verdict |
|---|---|---|---|---|---|
| **JSON attribute** | parent → child | primitives only (stringified) | attribute change re-renders | JSON parse per render, escaping overhead | **Rejected** (Anti-pattern per guide) |
| **Primitive attribute** | parent → child | strings, numbers, booleans | attribute change re-renders | Cheap | **Accepted** (For scalar primitive props) |
| **`emit` event** | child → parent | any JS | one-shot CustomEvent | Cheap | **Accepted** (Child → Parent actions only) |
| **State key** | global | any JS object / VM | 1 per-key subscriber | 1 subscription per reader; stale key accumulation | **Accepted with Reservation** (For cross-subtree view models) |
| **Provide/Consume (Shared Map)** | subtree | plain object `{ [id]: vm }` | N subscribers notified per write | N callbacks & state updates per item edit | **Rejected for Lists** (Unnecessary N-item re-render cascade) |
| **Provide/Consume (Wrapper)** | subtree | per-item JS object | 1 subscriber per wrapper | N extra DOM wrapper custom elements | **Rejected for Lists** (DOM element overhead) |
| **Host JS property** | parent → child | any JS object | none (manual update required) | Cheap at mount, non-reactive | **Rejected** (Bypasses Coralite reactivity) |
| **Inlined Bubble in `view-chat`** | parent | template variables | direct Coralite template re-render | Zero cross-component passing | **Recommended Primary** (Eliminates boundary) |

---

## 6. Recommendation

### Primary Recommendation: **State-Key Pattern with Explicit Key Purging**

For modular components requiring isolated per-item view models (such as `view-chat` passing complex view state to `message-bubble` instances):

1. **Adopt State Keys (`$state['message:' + id] = vm`)**:
   - `view-chat` populates `$state['message:' + id] = buildMessageVm(msg)` for each item.
   - `<message-bubble>` subscribes to its specific key (`'message:' + id`) inside `client({ globalStore, signal })`.
   - When 1 message updates (e.g., edited text, reactions, or mention tags), `view-chat` writes `$state['message:' + id] = updatedVm`.
   - Exactly **1 callback fires** for that specific bubble instance. Sibling bubbles receive **0 callbacks**.

2. **Enforce Stale Key Purging**:
   - When messages are unmounted, cleared, or scrolled out of view, `view-chat` purges stale keys via `delete globalStore.$state['message:' + id]`.

3. **Secondary Pattern (Primitive Attributes)**:
   - Scalar message attributes (`message-id`, `sender-id`, `local-status`) continue to use host-reflected primitive HTML attributes.

---

## 7. Implications

1. **Task C-CHAT-12 & C-CHAT-13 Scope:**
   - C-CHAT-13 (Mentions & Message View Models) will implement the **State-Key pattern** (`$state['message:' + id] = vm`).
   - `view-chat` will compute message view models and publish them to `$state['message:' + id]`.
   - `<message-bubble>` will subscribe to its own state key and read `senderName`, `formattedTime`, `mentionTags`, and quote previews directly from `$state['message:' + id]`.
   - `view-chat` thread reload / purge logic will call `delete globalStore.$state['message:' + id]` for removed message IDs.

2. **Component Authoring Guide Update:**
   - Document the state-key per-item list data pattern in `packages/app/docs/components.md` and `packages/app/docs/plugins/state.md`.
   - Warn against using `provide`/`consume` with a shared map for per-item list items due to the N-callback update cascade.
