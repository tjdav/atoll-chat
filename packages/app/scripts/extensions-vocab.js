#!/usr/bin/env node
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildVocabulary, ExtensionRegistry } from '@atoll/extend'
import { extensions } from '../src/extensions/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(__dirname, '..')

const VALID_SECTIONS = new Set([
  'components',
  'slots',
  'events',
  'routes',
  'sessions',
  'preferences',
  'permissions',
  'icons',
  'platforms',
  'surfaces',
  'reserved'
])

/**
 * Main entrypoint for the extensions vocabulary CLI.
 *
 * @param {string[]} [argv] - Command line arguments.
 * @param {object} [io] - Output stream object with out and err methods.
 * @returns {number} Exit status code.
 */
export function main(argv = process.argv.slice(2), io = { out: console.log, err: console.error }) {
  const args = new Set(argv)
  const sectionArg = argv.find((a) => a.startsWith('--section='))
  const section = sectionArg ? sectionArg.slice('--section='.length) : null
  const json = args.has('--json')

  if (section && !VALID_SECTIONS.has(section)) {
    io.err(`Unknown section '${section}'. Allowed sections: ${Array.from(VALID_SECTIONS).join(', ')}`)
    return 1
  }

  const registry = new ExtensionRegistry()
  for (const ext of extensions) {
    registry.add(ext)
  }

  const vocab = buildVocabulary(registry, {
    componentsDir: resolve(appRoot, 'src/components')
  })

  const payload = section ? { [section]: vocab[section] } : vocab

  if (json) {
    io.out(JSON.stringify(payload, null, 2))
    return 0
  }

  if (!section || section === 'components') printComponents(payload.components, io)
  if (!section || section === 'slots') printSlots(payload.slots, io)
  if (!section || section === 'events') printEvents(payload.events, io)
  if (!section || section === 'routes') printRoutes(payload.routes, io)
  if (!section || section === 'sessions') printList('Sessions', payload.sessions, io)
  if (!section || section === 'preferences') printList('Preferences', payload.preferences, io)
  if (!section || section === 'permissions') printList('Permissions', payload.permissions, io)
  if (!section || section === 'icons') printList('Icons', payload.icons, io)
  if (!section || section === 'platforms') printList('Platforms', payload.platforms, io)
  if (!section || section === 'surfaces') printList('Surfaces', payload.surfaces, io)
  if (!section || section === 'reserved') printReserved(payload.reserved, io)

  return 0
}

function printComponents(items = [], io) {
  io.out(`Components (${items.length}):`)
  if (items.length === 0) {
    io.out('  (none)')
  } else {
    for (const item of items) {
      io.out(`  - ${item}`)
    }
  }
}

function printSlots(slotsMap = {}, io) {
  const hostIds = Object.keys(slotsMap).sort()
  let totalSlots = 0
  for (const h of hostIds) {
    totalSlots += Object.keys(slotsMap[h]).length
  }

  io.out(`Slots (${totalSlots}):`)
  if (totalSlots === 0) {
    io.out('  (none)')
  } else {
    for (const hostId of hostIds) {
      io.out(`  [${hostId}]`)
      const slotNames = Object.keys(slotsMap[hostId]).sort()
      for (const slotName of slotNames) {
        const meta = slotsMap[hostId][slotName]
        io.out(`    - ${slotName} (multiple: ${meta.multiple}, declaredAt: ${meta.declaredAt})`)
        if (meta.fillers.length === 0) {
          io.out('      fillers: (none)')
        } else {
          io.out('      fillers:')
          for (const f of meta.fillers) {
            io.out(`        * ${f.extensionId} -> ${f.component} (order: ${f.order})`)
          }
        }
      }
    }
  }
}

function printEvents(eventsMap = {}, io) {
  const eventNames = Object.keys(eventsMap).sort()
  io.out(`Events (${eventNames.length}):`)
  if (eventNames.length === 0) {
    io.out('  (none)')
  } else {
    for (const name of eventNames) {
      const e = eventsMap[name]
      io.out(`  - ${name}`)
      io.out(`    schema: ${JSON.stringify(e.schema)}`)
      io.out(`    emitters: ${e.emitters.length ? e.emitters.join(', ') : '(none)'}`)
      io.out(`    receivers: ${e.receivers.length ? e.receivers.join(', ') : '(none)'}`)
      io.out(`    listeners: ${e.listeners.length ? e.listeners.join(', ') : '(none)'}`)
    }
  }
}

function printRoutes(routesObj = {}, io) {
  const details = routesObj.details ?? []
  const lists = routesObj.lists ?? []
  io.out(`Routes (${details.length + lists.length}):`)
  io.out('  Details:')
  if (details.length === 0) {
    io.out('    (none)')
  } else {
    for (const d of details) {
      io.out(`    - ${d.route} (${d.extensionId})`)
    }
  }
  io.out('  Lists:')
  if (lists.length === 0) {
    io.out('    (none)')
  } else {
    for (const l of lists) {
      io.out(`    - ${l.route} (${l.extensionId})`)
    }
  }
}

function printList(title, items = [], io) {
  io.out(`${title} (${items.length}):`)
  if (items.length === 0) {
    io.out('  (none)')
  } else {
    for (const item of items) {
      if (typeof item === 'string') {
        io.out(`  - ${item}`)
      } else {
        io.out(`  - ${JSON.stringify(item)}`)
      }
    }
  }
}

function printReserved(reservedObj = {}, io) {
  io.out('Reserved:')
  io.out(`  Routes (${(reservedObj.routes ?? []).length}): ${reservedObj.routes?.join(', ') || '(none)'}`)
  io.out(`  Preference Keys (${(reservedObj.preferenceKeys ?? []).length}): ${reservedObj.preferenceKeys?.join(', ') || '(none)'}`)
  io.out(`  Preference Prefixes (${(reservedObj.preferencePrefixes ?? []).length}): ${reservedObj.preferencePrefixes?.join(', ') || '(none)'}`)
  io.out(`  Slots (${(reservedObj.slots ?? []).length}): ${reservedObj.slots?.join(', ') || '(none)'}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main())
}
