import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { defineExtension, ExtensionRegistry, validateLink } from '@atoll/extend'

describe('validateLink Phase 2 cross-extension link validation unit tests', () => {
  const baseHost = {
    id: 'core.chat',
    apiVersion: '1.0.0',
    hostApi: '2.0.0',
    detail: {
      route: 'chat',
      component: 'chat-view',
      title: 'Chat',
      slots: {
        header: { multiple: false }
      }
    },
    emits: [
      { event: 'chat:message', schema: { text: 'string' } }
    ]
  }

  const baseFiller = {
    id: 'vendor.calendar',
    apiVersion: '1.0.0',
    hostApi: '2.0.0',
    detail: {
      route: 'calendar',
      component: 'x-calendar-view',
      title: 'Calendar'
    },
    slots: [
      { slot: 'chat.header', component: 'x-calendar-widget', order: 1 }
    ],
    listens: [
      { event: 'chat:message', handler: () => {} }
    ]
  }

  test('1. Two extensions with the same detail.route throw', () => {
    const registry = new ExtensionRegistry()
    registry.add(defineExtension(baseHost))
    registry.add(defineExtension({
      id: 'vendor.other',
      apiVersion: '1.0.0',
      hostApi: '2.0.0',
      detail: { route: 'chat', component: 'x-other-view', title: 'Other' }
    }))

    assert.throws(() => {
      validateLink(registry)
    }, /Duplicate detail route 'chat'/)
  })

  test('2. A slot mount with no matching host declaration throws', () => {
    const registry = new ExtensionRegistry()
    registry.add(defineExtension({
      ...baseFiller,
      slots: [{ slot: 'missing.slot', component: 'x-calendar-widget', order: 1 }]
    }))

    assert.throws(() => {
      validateLink(registry)
    }, /mounts slot 'missing.slot', which is not declared/)
  })

  test('3. A host with multiple: false mounted by two extensions throws', () => {
    const registry = new ExtensionRegistry()
    registry.add(defineExtension(baseHost))
    registry.add(defineExtension(baseFiller))
    registry.add(defineExtension({
      id: 'vendor.other',
      apiVersion: '1.0.0',
      hostApi: '2.0.0',
      detail: { route: 'other', component: 'x-other-view', title: 'Other' },
      slots: [{ slot: 'chat.header', component: 'x-other-widget', order: 2 }]
    }))

    assert.throws(() => {
      validateLink(registry)
    }, /specifies multiple: false, but is mounted by multiple extensions/)
  })

  test('4. A listener with no matching emitter or publicEvent throws', () => {
    const registry = new ExtensionRegistry()
    registry.add(defineExtension({
      ...baseFiller,
      listens: [{ event: 'unemitted:event', handler: () => {} }]
    }))

    assert.throws(() => {
      validateLink(registry)
    }, /Unmatched event listener: event 'unemitted:event'/)
  })

  test('5. Two emitters of the same event with different schemas throw', () => {
    const registry = new ExtensionRegistry()
    registry.add(defineExtension(baseHost))
    registry.add(defineExtension({
      id: 'vendor.other',
      apiVersion: '1.0.0',
      hostApi: '2.0.0',
      detail: { route: 'other', component: 'x-other-view', title: 'Other' },
      emits: [
        { event: 'chat:message', schema: { text: 'number' } }
      ]
    }))

    assert.throws(() => {
      validateLink(registry)
    }, /Mismatched event schema for event 'chat:message'/)
  })

  test('6. Extension declaring reserved preference key throws in validateLink', () => {
    const registry = new ExtensionRegistry()
    registry.add({
      id: 'vendor.bypass',
      preferences: [{ key: 'room_order', type: 'array' }]
    })

    assert.throws(() => {
      validateLink(registry)
    }, /declares reserved preference key 'room_order'/)
  })

  test('7. Rail order collision produces a warning (does not throw)', () => {
    const registry = new ExtensionRegistry()
    registry.add(defineExtension({
      ...baseHost,
      label: 'Host',
      rail: { icon: { name: 'chat' }, order: 10 }
    }))
    registry.add(defineExtension({
      ...baseFiller,
      label: 'Filler',
      rail: { icon: { name: 'calendar' }, order: 10 }
    }))

    const { warnings } = validateLink(registry)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /Rail order collision: extensions .* share rail order 10/)
  })

  test('8. A valid pair of extensions passes with no errors and no warnings', () => {
    const registry = new ExtensionRegistry()
    registry.add(defineExtension(baseHost))
    registry.add(defineExtension(baseFiller))

    const { warnings } = validateLink(registry)
    assert.deepEqual(warnings, [])
  })
})
