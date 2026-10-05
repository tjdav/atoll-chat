import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { buildVocabulary, defineExtension, ExtensionRegistry, RESERVED_PREFERENCE_KEYS, RESERVED_PREFERENCE_PREFIXES, RESERVED_ROUTES } from '@atoll/extend'

describe('buildVocabulary unit tests', () => {
  const extHost = defineExtension({
    id: 'core.chat',
    apiVersion: '1.0.0',
    hostApi: '2.0.0',
    detail: {
      route: 'chat',
      component: 'chat-view',
      title: 'Chat',
      slots: {
        header: { multiple: true }
      }
    },
    emits: [
      { event: 'chat:message', schema: { text: 'string' } }
    ]
  })

  const extFiller1 = defineExtension({
    id: 'vendor.cal',
    apiVersion: '1.0.0',
    hostApi: '2.0.0',
    detail: {
      route: 'cal',
      component: 'x-cal-view',
      title: 'Cal'
    },
    slots: [
      { slot: 'chat.header', component: 'x-cal-widget', order: 10 }
    ],
    listens: [
      { event: 'chat:message', handler: () => {} }
    ]
  })

  const extFiller2 = defineExtension({
    id: 'vendor.notes',
    apiVersion: '1.0.0',
    hostApi: '2.0.0',
    detail: {
      route: 'notes',
      component: 'x-notes-view',
      title: 'Notes'
    },
    slots: [
      { slot: 'chat.header', component: 'x-notes-widget', order: 5 }
    ]
  })

  test('1. buildVocabulary over an empty registry returns empty sections and reserved metadata', () => {
    const registry = new ExtensionRegistry()
    const vocab = buildVocabulary(registry)

    assert.deepEqual(vocab.components, [])
    assert.deepEqual(vocab.slots, {})
    assert.deepEqual(vocab.events, {})
    assert.deepEqual(vocab.routes, { details: [], lists: [] })
    assert.deepEqual(vocab.sessions, [])
    assert.deepEqual(vocab.preferences, [])
    assert.deepEqual(vocab.permissions, [])
    assert.deepEqual(vocab.icons, [])
    assert.deepEqual(vocab.platforms, ['desktop', 'mobile', 'tablet'])
    assert.deepEqual(vocab.surfaces, ['overlay', 'panel'])
    assert.deepEqual(vocab.reserved.routes, ['404', 'index'])
  })

  test('2. With one extension, routes.details contains the detail route', () => {
    const registry = new ExtensionRegistry()
    registry.add(extHost)
    const vocab = buildVocabulary(registry)

    assert.equal(vocab.routes.details.length, 1)
    assert.equal(vocab.routes.details[0].route, 'chat')
    assert.equal(vocab.routes.details[0].extensionId, 'core.chat')
  })

  test('3. With two extensions filling the same slot, fillers are aggregated and sorted by order ASC', () => {
    const registry = new ExtensionRegistry()
    registry.add(extHost)
    registry.add(extFiller1)
    registry.add(extFiller2)
    const vocab = buildVocabulary(registry)

    const slotMeta = vocab.slots['core.chat']['header']
    assert.equal(slotMeta.fillers.length, 2)
    assert.equal(slotMeta.fillers[0].extensionId, 'vendor.notes')
    assert.equal(slotMeta.fillers[0].order, 5)
    assert.equal(slotMeta.fillers[1].extensionId, 'vendor.cal')
    assert.equal(slotMeta.fillers[1].order, 10)
  })

  test('4. Events aggregate emitters and listeners correctly', () => {
    const registry = new ExtensionRegistry()
    registry.add(extHost)
    registry.add(extFiller1)
    const vocab = buildVocabulary(registry)

    const eventEntry = vocab.events['chat:message']
    assert.deepEqual(eventEntry.emitters, ['core.chat'])
    assert.deepEqual(eventEntry.listeners, ['vendor.cal'])
    assert.deepEqual(eventEntry.schema, { text: 'string' })
  })

  test('5. components scans the provided componentsDir and returns template ids', () => {
    const registry = new ExtensionRegistry()
    const componentsDir = resolve(process.cwd(), 'src/components')
    const vocab = buildVocabulary(registry, { componentsDir })

    assert.equal(Array.isArray(vocab.components), true)
    assert.equal(vocab.components.includes('messenger-shell'), true)
  })

  test('6. Reserved section matches constants.js', () => {
    const registry = new ExtensionRegistry()
    const vocab = buildVocabulary(registry)

    assert.deepEqual(vocab.reserved.routes, Array.from(RESERVED_ROUTES).sort())
    assert.deepEqual(vocab.reserved.preferenceKeys, Array.from(RESERVED_PREFERENCE_KEYS).sort())
    assert.deepEqual(vocab.reserved.preferencePrefixes, Array.from(RESERVED_PREFERENCE_PREFIXES).sort())
  })
})
