import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  PERMISSIONS,
  PLATFORMS,
  RESERVED_PREFERENCE_KEYS,
  RESERVED_PREFERENCE_PREFIXES,
  RESERVED_ROUTES,
  RESERVED_SLOTS,
  SURFACES
} from './constants.js'

/**
 * Aggregates a vocabulary metadata object over a populated ExtensionRegistry.
 *
 * @param {import('./registry.js').ExtensionRegistry} registry
 * @param {object} [options]
 * @param {string} [options.componentsDir] - Path to `src/components/` directory.
 * @param {string[]} [options.icons] - Array of icon names.
 * @returns {object} Vocabulary aggregation.
 */
export function buildVocabulary(registry, options = {}) {
  const extensions = registry && typeof registry.list === 'function' ? registry.list() : []
  const componentsDir = options.componentsDir ?? null
  const icons = Array.isArray(options.icons) ? [...options.icons].sort() : []

  // 1. Components scan
  const components = componentsDir ? scanComponentTemplates(componentsDir) : []

  // 2. Slots map
  const slots = {}
  // First pass: collect declared slots from host extensions
  for (const ext of extensions) {
    const hostShortId = ext.id.split('.').pop()
    const recordDeclaredSlots = (slotObj, declaredAt) => {
      if (!slotObj || typeof slotObj !== 'object') return
      for (const [slotName, slotConfig] of Object.entries(slotObj)) {
        if (!slots[ext.id]) slots[ext.id] = {}
        const multiple = slotConfig && typeof slotConfig === 'object' ? (slotConfig.multiple !== false) : true
        slots[ext.id][slotName] = {
          multiple,
          declaredAt,
          fillers: []
        }
      }
    }
    if (ext.detail && ext.detail.slots) recordDeclaredSlots(ext.detail.slots, 'detail')
    if (ext.list && ext.list.slots) recordDeclaredSlots(ext.list.slots, 'list')
  }

  // Second pass: collect fillers mounting slots
  for (const ext of extensions) {
    if (!Array.isArray(ext.slots)) continue
    for (const mount of ext.slots) {
      if (!mount || typeof mount.slot !== 'string') continue
      const [hostShortId, slotName] = mount.slot.split('.')
      // Find matching host ext
      const hostExt = extensions.find((e) => e.id.split('.').pop() === hostShortId)
      if (hostExt && slots[hostExt.id] && slots[hostExt.id][slotName]) {
        slots[hostExt.id][slotName].fillers.push({
          extensionId: ext.id,
          component: mount.component,
          order: mount.order
        })
      }
    }
  }

  // Sort fillers in slots by order ASC, then extensionId ASC
  for (const hostId of Object.keys(slots)) {
    for (const slotName of Object.keys(slots[hostId])) {
      slots[hostId][slotName].fillers.sort((a, b) => a.order - b.order || a.extensionId.localeCompare(b.extensionId))
    }
  }

  // 3. Events map
  const events = {}
  for (const ext of extensions) {
    if (Array.isArray(ext.emits)) {
      for (const e of ext.emits) {
        if (!e || typeof e.event !== 'string') continue
        if (!events[e.event]) {
          events[e.event] = { schema: {}, emitters: [], receivers: [], listeners: [] }
        }
        if (!events[e.event].emitters.includes(ext.id)) events[e.event].emitters.push(ext.id)
        if (e.schema && typeof e.schema === 'object') {
          Object.assign(events[e.event].schema, e.schema)
        }
      }
    }
    if (Array.isArray(ext.publicEvents)) {
      for (const e of ext.publicEvents) {
        if (!e || typeof e.event !== 'string') continue
        if (!events[e.event]) {
          events[e.event] = { schema: {}, emitters: [], receivers: [], listeners: [] }
        }
        if (!events[e.event].emitters.includes(ext.id)) events[e.event].emitters.push(ext.id)
        if (!events[e.event].receivers.includes(ext.id)) events[e.event].receivers.push(ext.id)
        if (e.schema && typeof e.schema === 'object') {
          Object.assign(events[e.event].schema, e.schema)
        }
      }
    }
    if (Array.isArray(ext.listens)) {
      for (const l of ext.listens) {
        if (!l || typeof l.event !== 'string') continue
        if (!events[l.event]) {
          events[l.event] = { schema: {}, emitters: [], receivers: [], listeners: [] }
        }
        if (!events[l.event].listeners.includes(ext.id)) events[l.event].listeners.push(ext.id)
      }
    }
  }

  // Sort event arrays
  for (const eventName of Object.keys(events)) {
    events[eventName].emitters.sort()
    events[eventName].receivers.sort()
    events[eventName].listeners.sort()
  }

  // 4. Routes
  const details = []
  const lists = []
  for (const ext of extensions) {
    if (ext.detail && ext.detail.route) {
      details.push({ route: ext.detail.route, extensionId: ext.id })
    }
    if (ext.list && ext.list.route) {
      lists.push({ route: ext.list.route, extensionId: ext.id })
    }
  }
  details.sort((a, b) => a.route.localeCompare(b.route) || a.extensionId.localeCompare(b.extensionId))
  lists.sort((a, b) => a.route.localeCompare(b.route) || a.extensionId.localeCompare(b.extensionId))

  // 5. Sessions
  const sessions = []
  for (const ext of extensions) {
    if (Array.isArray(ext.sessions)) {
      for (const s of ext.sessions) {
        sessions.push({
          extensionId: ext.id,
          type: s.type,
          maxParticipants: s.maxParticipants,
          maxPerRoom: s.maxPerRoom,
          heartbeatInterval: s.heartbeatInterval
        })
      }
    }
  }
  sessions.sort((a, b) => a.extensionId.localeCompare(b.extensionId) || a.type.localeCompare(b.type))

  // 6. Preferences
  const preferences = []
  for (const ext of extensions) {
    if (Array.isArray(ext.preferences)) {
      for (const p of ext.preferences) {
        preferences.push({
          extensionId: ext.id,
          key: p.key,
          type: p.type,
          label: p.label
        })
      }
    }
  }
  preferences.sort((a, b) => a.extensionId.localeCompare(b.extensionId) || a.key.localeCompare(b.key))

  // 7. Permissions
  const permissionsSet = new Set()
  for (const ext of extensions) {
    if (Array.isArray(ext.permissions)) {
      for (const p of ext.permissions) permissionsSet.add(p)
    }
  }
  const permissions = Array.from(permissionsSet).sort()

  // 8. Reserved
  const reserved = {
    routes: [...RESERVED_ROUTES].sort(),
    preferenceKeys: [...RESERVED_PREFERENCE_KEYS].sort(),
    preferencePrefixes: [...RESERVED_PREFERENCE_PREFIXES].sort(),
    slots: [...RESERVED_SLOTS].sort()
  }

  return {
    components,
    slots,
    events,
    routes: { details, lists },
    sessions,
    preferences,
    permissions,
    icons,
    platforms: [...PLATFORMS].sort(),
    surfaces: [...SURFACES].sort(),
    reserved
  }
}

/**
 * Scans componentsDir recursively for HTML files and extracts `<template id="...">` values.
 */
function scanComponentTemplates(dir) {
  const templates = new Set()
  const TEMPLATE_ID_PATTERN = /<template\s+[^>]*id=["']([^"']+)["']/g

  function walk(currentDir) {
    let entries
    try {
      entries = readdirSync(currentDir)
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(currentDir, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          walk(fullPath)
        } else if (stat.isFile() && fullPath.endsWith('.html')) {
          const content = readFileSync(fullPath, 'utf-8')
          let match
          while ((match = TEMPLATE_ID_PATTERN.exec(content)) !== null) {
            templates.add(match[1])
          }
        }
      } catch {
        // Skip unreadable files/dirs
      }
    }
  }

  walk(dir)
  return Array.from(templates).sort()
}
