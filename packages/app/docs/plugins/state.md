# State Plugin Guide

> **Specification reference:** §4.5 (Shell State Model), §4.8 (Offline-First Model), §21.6 (OPFS Degradation)

The global state plugin provides reactive shell state across Coralite components via `globalStore`.

---

## Global Shell State Shape

The default shell state is defined by `DEFAULT_SHELL_STATE` in `packages/app/src/lib/state/index.js`:

```javascript
export const DEFAULT_SHELL_STATE = Object.freeze({
  isAuthenticated: false,
  currentUser: null,
  oprfToken: null,
  locale: 'en',
  storageReady: false,
  storagePersistent: true
})
```

---

## Storage Readiness Keys

The shell state includes two keys dedicated to storage status tracking:

- `storageReady`: `boolean` — Set to `true` once `storage.open()` completes during the boot sequence. Components that interact with the database can call `await storage.open()` independently; `open()` is idempotent.
- `storagePersistent`: `boolean` — Reflects whether the underlying database backend supports persistent storage across page reloads (`true` for WASM with OPFS, `false` for in-memory fallback or the memory backend).

### Spec Justification

These two state keys extend the spec §4.5 shell state property list. They are justified by §4.8 (Offline-First Model) and §21.6 (OPFS-unavailable degradation), which require surfacing ephemeral storage warnings when OPFS persistence is unavailable.

---

## What Lives Where

- `isAuthenticated`: Managed by `messenger-boot` and auth flows.
- `currentUser`: Populated on boot / login.
- `oprfToken`: In-memory session OPRF token.
- `locale`: Active app locale code (`'en'`, `'fr'`, etc.).
- `storageReady`: Updated by `messenger-boot` post-storage initialization.
- `storagePersistent`: Populated by `messenger-boot` from `storage.isPersistent()`.
