import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { defineExtension, validateExtensionShape } from '@atoll/extend'

describe('validateExtensionShape Phase 1 deep validation unit tests', () => {
  const baseCore = {
    id: 'core.chat',
    apiVersion: '1.0.0',
    hostApi: '2.0.0',
    detail: {
      route: 'chat',
      component: 'chat-view',
      title: 'Chat'
    }
  }

  const baseVendor = {
    id: 'vendor.calendar',
    apiVersion: '1.0.0',
    hostApi: '2.0.0',
    detail: {
      route: 'calendar',
      component: 'x-calendar-view',
      title: 'Calendar'
    }
  }

  test('1. Unknown permission throws', () => {
    assert.throws(() => {
      validateExtensionShape({
        ...baseVendor,
        permissions: ['invalid_permission']
      })
    }, /unknown permission 'invalid_permission'/)
  })

  test('2. Slot with an invalid slot format throws', () => {
    assert.throws(() => {
      validateExtensionShape({
        ...baseVendor,
        slots: [{ slot: 'invalid-slot-format', component: 'x-calendar-slot', order: 1 }]
      })
    }, /invalid slot format/)
  })

  test('3. Slot with an invalid component tag throws', () => {
    assert.throws(() => {
      validateExtensionShape({
        ...baseVendor,
        slots: [{ slot: 'chat.header', component: 'InvalidTag', order: 1 }]
      })
    }, /component 'InvalidTag' must be a valid hyphenated custom element tag name/)
  })

  test('4. Emit with an invalid event name throws', () => {
    assert.throws(() => {
      validateExtensionShape({
        ...baseVendor,
        emits: [{ event: 'invalid-event-name' }]
      })
    }, /invalid event name/)
  })

  test('5. Emit with a nested schema value throws', () => {
    assert.throws(() => {
      validateExtensionShape({
        ...baseVendor,
        emits: [{ event: 'calendar:updated', schema: { payload: { nested: 'string' } } }]
      })
    }, /invalid schema type/)
  })

  test('6. Listen without a handler throws', () => {
    assert.throws(() => {
      validateExtensionShape({
        ...baseVendor,
        listens: [{ event: 'chat:message' }]
      })
    }, /listener handler must be a function/)
  })

  test('7. Session with a non-integer heartbeatInterval throws', () => {
    assert.throws(() => {
      validateExtensionShape({
        ...baseVendor,
        sessions: [{
          type: 'whiteboard',
          maxParticipants: 10,
          maxPerRoom: 2,
          heartbeatInterval: 10.5
        }]
      })
    }, /heartbeatInterval must be a positive integer in seconds/)
  })

  test('8. Preference with an invalid key format throws', () => {
    assert.throws(() => {
      validateExtensionShape({
        ...baseVendor,
        preferences: [{ key: 'invalid-key-with-dashes', type: 'string' }]
      })
    }, /preference key 'invalid-key-with-dashes' must match/)
  })

  test('9. Preference with a reserved key throws', () => {
    assert.throws(() => {
      validateExtensionShape({
        ...baseVendor,
        preferences: [{ key: 'room_order', type: 'array' }]
      })
    }, /preference key 'room_order' is reserved/)
  })

  test('10. Asset without dest throws', () => {
    assert.throws(() => {
      validateExtensionShape({
        ...baseVendor,
        assets: [{ src: '/public/file.png' }]
      })
    }, /dest must be a non-empty string path/)
  })

  test('11. Reserved route index on detail.route throws', () => {
    assert.throws(() => {
      validateExtensionShape({
        ...baseVendor,
        detail: {
          route: 'index',
          component: 'x-calendar-view',
          title: 'Index'
        }
      })
    }, /detail\.route 'index' is reserved/)
  })

  test('12. Component tag naming: core.* vs non-core.* prefix enforcement', () => {
    // core.* allowed kebab-case tag without x- prefix
    assert.doesNotThrow(() => {
      defineExtension(baseCore)
    })

    // non-core.* requiring x-<slug>- prefix
    assert.throws(() => {
      defineExtension({
        ...baseVendor,
        detail: {
          route: 'calendar',
          component: 'calendar-view',
          title: 'Calendar'
        }
      })
    }, /must start with 'x-calendar-'/)

    // valid x-<slug>- prefix passes
    assert.doesNotThrow(() => {
      defineExtension(baseVendor)
    })
  })
})
