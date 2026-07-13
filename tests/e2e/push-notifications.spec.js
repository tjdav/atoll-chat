import { test, expect } from './fixtures/base-test.js'

test.describe('Platform-Agnostic Push Notifications Plugin', () => {
  test('should request push permissions and register when vault is unlocked', async ({ page, loginApp }) => {
    const logs = []
    page.on('console', msg => {
      logs.push(msg.text())
    })

    /* Enable simulated PushManager support and mock permissions on initial page load */
    await page.addInitScript(() => {
      Object.defineProperty(window.Notification, 'permission', {
        get () {
          return 'granted'
        }
      })
      window.Notification.requestPermission = async () => 'granted'

      /* Define MockPushManager class to avoid Illegal Constructor error */
      class MockPushManager {
        async getSubscription () {
          return null
        }

        async subscribe () {
          return {
            endpoint: 'https://updates.push.services.mozilla.com/push/v1/gAAAAAB...',
            keys: {
              p256dh: 'BAs=',
              auth: 'c3g='
            },
            toJSON () {
              return {
                endpoint: this.endpoint,
                keys: this.keys
              }
            }
          }
        }
      }

      window.PushManager = MockPushManager

      /* Mock ServiceWorkerRegistration.pushManager */
      if ('ServiceWorkerRegistration' in window) {
        Object.defineProperty(window.ServiceWorkerRegistration.prototype, 'pushManager', {
          get () {
            return new MockPushManager()
          },
          configurable: true
        })
      }
    })

    /* Perform successful login & unlock */
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    /* Verify standard app-layout is visible */
    await expect(page.locator('app-layout')).toBeVisible()

    /* Assert that the push plugin requested permission and registered successfully */
    let pushRegistered = false
    for (let i = 0; i < 20; i++) {
      if (logs.some(log => log.includes('[app-root] Push registration successful') || log.includes('Push subscription updated on backend successfully'))) {
        pushRegistered = true
        break
      }
      await page.waitForTimeout(500)
    }

    expect(pushRegistered).toBe(true)
  })
})
