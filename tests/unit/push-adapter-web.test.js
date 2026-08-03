import { test } from 'node:test'
import assert from 'node:assert'
import { createWebPushAdapter } from '../../src/plugins/push-adapter-web.js'

test('WebPushAdapter', async (t) => {
  await t.test('should throw an error if vapidKey is missing or empty', async () => {
    const adapter = createWebPushAdapter()

    await assert.rejects(
      () => adapter.register(null),
      {
        name: 'Error',
        message: '[WebPushAdapter] VAPID public key is required for registration.'
      }
    )

    await assert.rejects(
      () => adapter.register(''),
      {
        name: 'Error',
        message: '[WebPushAdapter] VAPID public key is required for registration.'
      }
    )
  })

  await t.test('should register successfully with a valid VAPID key', async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

    // Mock navigator.serviceWorker and window.PushManager
    const mockNavigator = {
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => null,
            subscribe: async (options) => {
              assert.strictEqual(options.userVisibleOnly, true)
              assert.ok(options.applicationServerKey instanceof Uint8Array)
              return {
                toJSON: () => ({ endpoint: 'https://example.com/push-endpoint' })
              }
            }
          }
        })
      }
    }

    const mockWindow = {
      PushManager: class {
      },
      atob: (str) => Buffer.from(str, 'base64').toString('binary')
    }

    Object.defineProperty(globalThis, 'navigator', {
      value: mockNavigator,
      writable: true,
      configurable: true
    })

    Object.defineProperty(globalThis, 'window', {
      value: mockWindow,
      writable: true,
      configurable: true
    })

    try {
      const adapter = createWebPushAdapter()
      const validVapidKey = 'BG6jbL6oHXUyR8hntptF57uh1ZC229JFqe0t4moskBqFNFhN8nYrCUma47Vmlg7eL1NhmyO8BKznjpqTx_T-7XQ'
      const subscription = await adapter.register(validVapidKey)
      assert.deepStrictEqual(subscription, { endpoint: 'https://example.com/push-endpoint' })
    } finally {
      // Clean up globals
      if (originalNavigator) {
        Object.defineProperty(globalThis, 'navigator', originalNavigator)
      } else {
        delete globalThis.navigator
      }

      if (originalWindow) {
        Object.defineProperty(globalThis, 'window', originalWindow)
      } else {
        delete globalThis.window
      }
    }
  })
})
