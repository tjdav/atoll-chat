# Task C-V-E — Verify Coralite rc.5 Plugin Context Delivery and c-token Reactivity Report

## 1. Questions

1. What is the runtime shape of the object returned by `client.context(pluginContext)`?
2. Does rc.5 deliver plugin context to `getters`, `server`, and `client`? Which of these receive it?
3. If plugin context reaches `client`, is it namespaced under the plugin's `name`?
4. How does a value produced in `server()` become a bound `<c-token>`? Is an `attributes` declaration required?
5. Does `state.x = value` in `client()` propagate to a `<c-token>` binding without an `attributes` declaration?
6. Which of the hypotheses in the C-INFRA-6 symptom description is the actual cause?

---

## 2. Method

### Workspace State Classification (Step 0)
- `node --version`: `v22.22.1` (installed local runtime environment).
- `packages/app/src/plugins/i18n-plugin.js`: Missing (directory `packages/app/src/plugins` does not exist in the active working tree).
- `packages/app/src/components/containers/auth-view-login.html`: Present.
- Classification: **Case B** (missing plugin file) and **Case C** (Node.js version below 24).

### Source Code Analysis
Inspected the installed Coralite rc.5 package (`coralite@1.0.0-rc.5`) source files:
- `node_modules/coralite/dist/lib/index.js` (script manager, plugin context compilation, and server function execution)
- `node_modules/coralite/dist/lib/coralite-element.js` (client element hydration, getter execution, reactive state proxy)

### Empirical Experiments
Conducted four controlled experiments in a temporary scratch directory (`/tmp/coralite-context-verify`):
1. **Plugin Context Shape & Delivery:** Declared a plugin `testPlugin` with `client.context = (pluginContext) => (instanceContext) => ({ hello: () => 'world' })`. Checked parameters and context property keys in `server()`, `getters`, and `client()`.
2. **Two-Phase Resolver:** Verified that `client.context` MUST return a function for Phase 2 (`instanceContext`).
3. **`attributes` & Reactivity Requirement:** Tested `<c-token>` updates with and without `attributes` schema declarations for both `server()` return values and `client()` state assignments (`state.greeting = 'value'`).
4. **C-INFRA-6 Symptom Reproduction:** Built a test component using flat destructuring `client(({ state, t }) => ...)` vs namespaced access `client(({ state, i18n }) => ...)` to isolate the cause of empty `<c-token>` placeholders.

---

## 3. Evidence

### Source Code Excerpt 1 — Plugin Context Factories & Namespacing
From `node_modules/coralite/dist/lib/index.js` (lines 4392–4402 & 4420–4452):

```javascript
// Plugin context compilation in index.js:
contents += `  ${safeClientName}: async (globalContext) => { ... }`;

// Client context proxy initialization:
const getClientContext = async (instanceContext) => {
  const factories = await resolvedContextFactoriesPromise;
  const cache = new Map();
  const clientMocks = ${clientMocksStr};

  return new Proxy(instanceContext, {
    get(target, prop, receiver) {
      if (prop === 'then') return undefined;
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
      if (cache.has(prop)) return cache.get(prop);

      const factory = factories[prop];
      if (factory === undefined) return undefined;

      if (typeof factory !== 'function') {
         throw new Error('Coralite Plugin Error: The plugin "' + String(prop) + '" must be a function for the second phase (instance context). Received: ' + typeof factory);
      }

      let resolved = factory(receiver);
      cache.set(prop, resolved);
      return resolved;
    },
    ...
  });
};
```

### Source Code Excerpt 2 — Getter Context Object Construction
From `node_modules/coralite/dist/lib/coralite-element.js` (lines 1858–1865):

```javascript
context = {
  state: roState,
  root: this,
  refs: getRef,
  slots: this._getSlotsHelper(),
  signal: null
};
this._getterContexts.set(key, context);
return getter(context);
```

### Source Code Excerpt 3 — Server Function State Assignment
From `node_modules/coralite/dist/lib/index.js` (lines 11617–11620):

```javascript
state.__script__.server = serverResult;
Object.assign(state, serverResult);
if (state.__script__.defaultValues) {
  Object.assign(state.__script__.defaultValues, serverResult);
}
```

### Source Code Excerpt 4 — Reactive State Mutation Trap
From `node_modules/coralite/dist/lib/coralite-element.js` (lines 2480–2489):

```javascript
t[p] = v;
if (isStrProp) {
  if (!kebabName) {
    kebabName = camelToKebab(camelName);
  }
  self._reflectAttributeChange(camelName, p, options.attributes?.[camelName] || options.attributes?.[p], { value: v }, kebabName);
  self._observeSlotStateKey(p);
  if (!p.includes("-") && p === p.toLowerCase()) {
    self._markKeysDirty(p);
  } else {
    self._markKeysDirty(camelName, kebabName, p);
  }
}
self._scheduleUpdate();
```

---

## 4. Answers

### Question 1: Runtime shape of `client.context(pluginContext)`
**Answer:** Two-phase curried function `(pluginContext) => (instanceContext) => contextObject`.
- Phase 1 takes `pluginContext` (proxy over globalContext and plugin config) and MUST return a function for Phase 2.
- Phase 2 takes `instanceContext` (the component instance receiver) and returns a plain object containing methods and properties provided by the plugin.
- Cites: Source Code Excerpt 1 (`index.js` lines 4843–4855).

### Question 2: Plugin context delivery across `server()`, `getters`, and `client()`
**Answer:** ONLY `client()` receives plugin context.
- `client()` receives `localContext`, which wraps `instanceContext` in a Proxy resolving plugin context factories under plugin names (`ctx.<pluginName>`).
- `getters` receive strictly `{ state, root, refs, slots, signal }`. Getters do NOT receive plugin context.
- `server()` receives server execution context (`{ request, response, state, module, root, contextFrames, ... }`), which does NOT receive client plugin context unless defined in a separate `server: { context: ... }` plugin hook.
- Cites: Source Code Excerpt 2 (`coralite-element.js` lines 1858–1865) and Source Code Excerpt 1 (`index.js` lines 4420–4452).

### Question 3: Namespacing of plugin context
**Answer:** YES. Plugin context is strictly namespaced under the plugin's registered `name` (e.g. `ctx.i18n`).
- The Proxy `get` trap looks up `factories[prop]` where `prop` is `plugin.name`.
- `ctx.i18n` resolves to `{ t: ... }`.
- Destructuring flat (`client(({ state, t }) => ...)`) results in `t === undefined`.
- Cites: Source Code Excerpt 1 (`index.js` lines 4420–4443).

### Question 4: Binding `server()` return values to `<c-token>`
**Answer:** `server()` return values are merged into component state (`Object.assign(state, serverResult)`). During SSR, template expressions `{{ key }}` evaluate against server state to populate `<c-token>` placeholders. An `attributes` declaration is NOT required.
- Cites: Source Code Excerpt 3 (`index.js` lines 11617–11620).

### Question 5: `state.x = value` reactivity in `client()`
**Answer:** YES. Assigning `state.x = value` on `this._state` invokes the Proxy `set` trap, marks key `x` dirty, and schedules a DOM update. An `attributes` declaration is NOT required for reactive properties assigned in `client()`.
- Cites: Source Code Excerpt 4 (`coralite-element.js` lines 2480–2489).

### Question 6: Primary root cause of C-INFRA-6 migration symptom
**Answer:** **Flat destructuring of plugin context**.
- In C-INFRA-6, migrated components destructured `t` flat: `client(({ state, t }) => ... )`.
- Because plugin context is namespaced under `ctx.i18n`, `t` was `undefined`.
- Executing `t('key')` threw an unhandled `TypeError: t is not a function`, crashing the component's `client()` block before `state.titleText = ...` was executed.
- Because `client()` crashed, reactive state was never assigned and `<c-token>` placeholders remained empty.

---

## 5. Recommendation

### Plugin Definition Pattern
```javascript
import { definePlugin } from 'coralite';

export const i18nPlugin = definePlugin({
  name: 'i18n',
  client: {
    context: (pluginContext) => {
      // Phase 1: Initialize global plugin resources (e.g. locale dictionaries)
      return (instanceContext) => {
        // Phase 2: Return per-instance helper object namespaced under plugin name
        return {
          t: (key, vars) => translate(key, vars)
        };
      };
    }
  }
});
```

### Component Usage Pattern
```html
<template id="auth-view-login">
  <h1>{{ titleText }}</h1>
</template>

<script type="module">
export default {
  async client({ state, i18n }) {
    // Access t via namespaced i18n object
    state.titleText = i18n.t('login_title');
  }
};
</script>
```

Key rules:
1. **Never destructure `t` flat in `client()`.** Always destructure `i18n` (`client(({ state, i18n }) => { state.title = i18n.t(...) })`).
2. **Never call `t()` in getters.** Getters do not receive plugin context in Coralite rc.5. Translate strings inside `client()` or `server()`.
3. **Do not add unnecessary `attributes` declarations for translated UI strings.** `state.key = value` in `client()` is fully reactive.

---

## 6. Implications

1. **C-INFRA-6c:** Unblocked and re-scoped. C-INFRA-6c will:
   - Create `packages/app/src/plugins/i18n-plugin.js` using two-phase `client.context`.
   - Update all migrated components to destructure `i18n` (namespaced) in `client()`.
   - Ensure no getters attempt to access `t()`.
2. **C-INFRA-6b:** C-INFRA-6b (if previously assumed to fix a hypothetical framework bug) is superseded by this report's findings. Components simply need correct namespaced destructuring.
