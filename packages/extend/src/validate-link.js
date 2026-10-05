import {
  RESERVED_PREFERENCE_KEYS,
  RESERVED_PREFERENCE_PREFIXES
} from './constants.js'

/**
 * Executes Phase 2 cross-extension link validation over a fully populated ExtensionRegistry.
 *
 * Checks cross-extension rules (routes, slots, events, preferences, sessions) and returns
 * warnings or throws a plain Error on validation failure.
 *
 * @param {import('./registry.js').ExtensionRegistry} registry
 * @returns {{ warnings: string[] }}
 */
export function validateLink(registry) {
  if (!registry || typeof registry.list !== 'function') {
    throw new Error('validateLink requires a valid ExtensionRegistry instance')
  }

  const extensions = registry.list()
  const errors = []
  const warnings = []

  // 1. Route declarations tracking
  const detailRoutes = new Map() // route -> extId
  const listRoutes = new Map()   // route -> extId

  // 2. Declared slot map: hostShortId.slotName -> { hostId, multiple, declaredAt }
  const declaredSlots = new Map()

  // 3. Event declarations: eventName -> { emitters: Set<extId>, listeners: Set<{ extId, handler }>, schemas: Map<extId, schemaObj> }
  const events = new Map()

  // Helper for tracking event declarations
  const trackEventDecl = (extId, eventName, schema, isEmitter) => {
    if (!events.has(eventName)) {
      events.set(eventName, { emitters: new Set(), listeners: new Set(), schemas: new Map() })
    }
    const entry = events.get(eventName)
    if (isEmitter) {
      entry.emitters.add(extId)
    }
    if (schema) {
      entry.schemas.set(extId, schema)
    }
  }

  // 4. Session types: (extId, type) -> true
  const sessionTypes = new Map()

  // Populate maps & validate per-extension link rules
  for (const ext of extensions) {
    const hostShortId = ext.id.split('.').pop()

    // 1. Routes
    if (ext.detail && ext.detail.route) {
      const route = ext.detail.route
      if (detailRoutes.has(route)) {
        errors.push(`Duplicate detail route '${route}' declared by extensions '${detailRoutes.get(route)}' and '${ext.id}'. Change one of the detail.route names.`)
      } else {
        detailRoutes.set(route, ext.id)
      }
    }

    if (ext.list && ext.list.route) {
      const route = ext.list.route
      if (listRoutes.has(route)) {
        errors.push(`Duplicate list route '${route}' declared by extensions '${listRoutes.get(route)}' and '${ext.id}'. Change one of the list.route names.`)
      } else {
        listRoutes.set(route, ext.id)
      }
    }

    // 2. Declared slots
    const recordDeclaredSlots = (slotObj, declaredAt) => {
      if (!slotObj || typeof slotObj !== 'object') return
      for (const [slotName, slotConfig] of Object.entries(slotObj)) {
        const fullKey = `${hostShortId}.${slotName}`
        const multiple = slotConfig && typeof slotConfig === 'object' ? (slotConfig.multiple !== false) : true
        declaredSlots.set(fullKey, { hostId: ext.id, multiple, declaredAt })
      }
    }
    if (ext.detail && ext.detail.slots) recordDeclaredSlots(ext.detail.slots, 'detail')
    if (ext.list && ext.list.slots) recordDeclaredSlots(ext.list.slots, 'list')

    // 3. Events
    if (Array.isArray(ext.emits)) {
      ext.emits.forEach((e) => trackEventDecl(ext.id, e.event, e.schema, true))
    }
    if (Array.isArray(ext.publicEvents)) {
      ext.publicEvents.forEach((e) => trackEventDecl(ext.id, e.event, e.schema, true))
    }
    if (Array.isArray(ext.listens)) {
      ext.listens.forEach((l) => {
        if (!events.has(l.event)) {
          events.set(l.event, { emitters: new Set(), listeners: new Set(), schemas: new Map() })
        }
        events.get(l.event).listeners.add(ext.id)
      })
    }

    // 4. Session types
    if (Array.isArray(ext.sessions)) {
      ext.sessions.forEach((s) => {
        const key = `${ext.id}:${s.type}`
        if (sessionTypes.has(key)) {
          errors.push(`Duplicate session type '${s.type}' declared in extension '${ext.id}'. Session types must be unique within an extension.`)
        } else {
          sessionTypes.set(key, true)
        }
      })
    }

    // 5. Reserved preference keys & prefixes
    if (Array.isArray(ext.preferences)) {
      ext.preferences.forEach((p) => {
        if (RESERVED_PREFERENCE_KEYS.includes(p.key)) {
          errors.push(`Extension '${ext.id}' declares reserved preference key '${p.key}'. Use a non-reserved preference key.`)
        }
        for (const pfx of RESERVED_PREFERENCE_PREFIXES) {
          if (p.key.startsWith(pfx)) {
            errors.push(`Extension '${ext.id}' declares preference key '${p.key}' with reserved prefix '${pfx}'. Remove the reserved prefix.`)
          }
        }
      })
    }
  }

  // Cross-route collision: detail route equals list route
  for (const [route, dExtId] of detailRoutes.entries()) {
    if (listRoutes.has(route)) {
      const lExtId = listRoutes.get(route)
      errors.push(`Route collision: route '${route}' is declared as detail route by '${dExtId}' and list route by '${lExtId}'. Use distinct route names.`)
    }
  }

  // Slot mounts validation & graph
  const slotMountsBySlot = new Map() // slotKey -> Array<{ extId, component, order }>
  const slotMountGraph = new Map()   // mountedExtId -> Set<hostExtId>

  for (const ext of extensions) {
    if (!Array.isArray(ext.slots)) continue
    for (const mount of ext.slots) {
      const targetSlotKey = mount.slot
      if (!declaredSlots.has(targetSlotKey)) {
        errors.push(`Extension '${ext.id}' mounts slot '${targetSlotKey}', which is not declared by any registered host extension. Register the host extension or remove the slot mount.`)
        continue
      }

      if (!slotMountsBySlot.has(targetSlotKey)) {
        slotMountsBySlot.set(targetSlotKey, [])
      }
      slotMountsBySlot.get(targetSlotKey).push({ extId: ext.id, component: mount.component, order: mount.order })

      const hostId = declaredSlots.get(targetSlotKey).hostId
      if (!slotMountGraph.has(ext.id)) {
        slotMountGraph.set(ext.id, new Set())
      }
      slotMountGraph.get(ext.id).add(hostId)
    }
  }

  // Check multiple = false non-multiple fillers
  for (const [slotKey, fillers] of slotMountsBySlot.entries()) {
    const slotMeta = declaredSlots.get(slotKey)
    if (slotMeta && !slotMeta.multiple && fillers.length > 1) {
      const fillerIds = fillers.map((f) => f.extId).join(', ')
      errors.push(`Slot '${slotKey}' declared by '${slotMeta.hostId}' specifies multiple: false, but is mounted by multiple extensions (${fillerIds}). Only one extension may mount a non-multiple slot.`)
    }
  }

  // Circular slot mounts detection (A mounts B's slot, B mounts A's slot)
  for (const [extA, hostsOfA] of slotMountGraph.entries()) {
    for (const extB of hostsOfA) {
      if (extA !== extB && slotMountGraph.has(extB) && slotMountGraph.get(extB).has(extA)) {
        errors.push(`Circular slot mount detected between '${extA}' and '${extB}'. Break the circular dependency.`)
      }
    }
  }

  // Unmatched listeners & event schema matching
  for (const [eventName, meta] of events.entries()) {
    if (meta.listeners.size > 0 && meta.emitters.size === 0) {
      const listenerList = Array.from(meta.listeners).join(', ')
      errors.push(`Unmatched event listener: event '${eventName}' is listened to by (${listenerList}) but never emitted or declared as publicEvent by any registered extension. Register an emitter extension or remove the listener.`)
    }

    // Event schema consistency check
    if (meta.schemas.size > 1) {
      const schemasList = Array.from(meta.schemas.entries())
      const [firstExt, firstSchema] = schemasList[0]
      for (let i = 1; i < schemasList.length; i++) {
        const [otherExt, otherSchema] = schemasList[i]
        if (!areSchemasEqual(firstSchema, otherSchema)) {
          errors.push(`Mismatched event schema for event '${eventName}': declared differently by '${firstExt}' (${JSON.stringify(firstSchema)}) and '${otherExt}' (${JSON.stringify(otherSchema)}). Align the event schemas.`)
        }
      }
    }
  }

  // Warnings checks
  // 1. Rail order collisions
  const railOrders = new Map() // order -> extId
  for (const ext of extensions) {
    if (ext.rail && typeof ext.rail.order === 'number') {
      const order = ext.rail.order
      if (railOrders.has(order)) {
        warnings.push(`Rail order collision: extensions '${railOrders.get(order)}' and '${ext.id}' share rail order ${order}.`)
      } else {
        railOrders.set(order, ext.id)
      }
    }
  }

  // 2. Duplicate action icons in overflow
  const actionIconsBySurface = new Map() // surface -> Map<iconName, extId>
  for (const ext of extensions) {
    const checkActions = (actions, surfaceName) => {
      if (!Array.isArray(actions)) return
      if (!actionIconsBySurface.has(surfaceName)) {
        actionIconsBySurface.set(surfaceName, new Map())
      }
      const map = actionIconsBySurface.get(surfaceName)
      for (const act of actions) {
        if (act && act.icon && typeof act.icon.name === 'string') {
          const icon = act.icon.name
          if (map.has(icon)) {
            warnings.push(`Duplicate action icon '${icon}' in surface '${surfaceName}' declared by '${map.get(icon)}' and '${ext.id}'.`)
          } else {
            map.set(icon, ext.id)
          }
        }
      }
    }
    if (ext.detail) checkActions(ext.detail.actions, 'detail')
    if (ext.list) checkActions(ext.list.actions, 'list')
  }

  // 3. Scope key type inconsistency
  const scopeKeys = new Map() // keyName -> { extId, type }
  for (const ext of extensions) {
    const checkScope = (scopeObj) => {
      if (!scopeObj || typeof scopeObj !== 'object') return
      for (const [sKey, sVal] of Object.entries(scopeObj)) {
        const typeStr = typeof sVal === 'object' && sVal !== null ? (sVal.type ?? typeof sVal) : typeof sVal
        if (scopeKeys.has(sKey)) {
          const prev = scopeKeys.get(sKey)
          if (prev.type !== typeStr) {
            warnings.push(`Scope key type inconsistency: scope key '${sKey}' declared as '${prev.type}' by '${prev.extId}' and '${typeStr}' by '${ext.id}'.`)
          }
        } else {
          scopeKeys.set(sKey, { extId: ext.id, type: typeStr })
        }
      }
    }
    if (ext.detail) checkScope(ext.detail.scope)
    if (ext.list) checkScope(ext.list.scope)
  }

  if (errors.length > 0) {
    throw new Error(`Extension Link Validation Failed:\n- ${errors.join('\n- ')}`)
  }

  return { warnings }
}

/**
 * Checks two schema objects for structural equality.
 */
function areSchemasEqual(schemaA, schemaB) {
  if (schemaA === schemaB) return true
  if (!schemaA || !schemaB) return false
  const keysA = Object.keys(schemaA).sort()
  const keysB = Object.keys(schemaB).sort()
  if (keysA.length !== keysB.length) return false
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false
    if (schemaA[keysA[i]] !== schemaB[keysB[i]]) return false
  }
  return true
}
