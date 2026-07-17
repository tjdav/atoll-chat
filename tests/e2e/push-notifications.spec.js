import { test, expect } from './fixtures/base-test.js'

test.describe('Platform-Agnostic Push Notifications Plugin', () => {
  test.beforeEach(async ({ page }) => {
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
            endpoint: 'https://updates.push.services.mozilla.com/push/v1/gAAAAAB_ALICE...',
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
  })

  test('should request push permissions and register when vault is unlocked', async ({ page, loginApp }) => {
    const logs = []
    page.on('console', msg => {
      logs.push(msg.text())
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

  test('should dispatch and filter push notification recipients correctly when a message is sent', async ({ page, loginApp, request }) => {
    /* Log in as Alice first so that window is loaded and we can retrieve the active E2E testId */
    await loginApp('alice', 'Password123!', 'VaultPassword123!')
    await expect(page.locator('app-layout')).toBeVisible()

    const testId = await page.evaluate(() => {
      return window.__playwright_test_id__ || 'default'
    })

    console.log(`[TEST] Using resolved E2E testId: ${testId}`)
    const headers = { 'x-test-id': testId }

    /* Set up other users' mock push subscriptions on the backend database */
    await request.patch(`http://localhost:8090/api/collections/users/records/bob`, {
      headers,
      data: {
        push_subscription: {
          endpoint: 'https://updates.push.services.mozilla.com/push/v1/gAAAAAB_BOB...',
          keys: {
            p256dh: 'BAs=',
            auth: 'c3g='
          }
        }
      }
    })

    await request.patch(`http://localhost:8090/api/collections/users/records/charlie`, {
      headers,
      data: {
        push_subscription: {
          endpoint: 'https://updates.push.services.mozilla.com/push/v1/gAAAAAB_CHARLIE...',
          keys: {
            p256dh: 'BAs=',
            auth: 'c3g='
          }
        }
      }
    })

    /* Create a group room involving Alice, Bob, and Charlie */
    await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await expect(page.locator('.modal-title:has-text("Create New Room")')).toBeVisible()

    /* Search and add Bob */
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()

    /* Search and add Charlie */
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('charlie')
    await page.locator('[data-testid$="search-result-charlie"]').click()

    /* Fill Group Name and submit */
    await page.locator('[data-testid="create-room-modal-0__roomNameInput"]').fill('Push Test Group')
    await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    /* Wait for room list to update and room to be selected */
    await expect(page.locator('chat-view')).toBeVisible()

    /* Mute Charlie inside the room members database for this testId to assert filtering */
    const membersRes = await request.get(`http://localhost:8090/api/collections/room_members/records?filter=user_id="charlie"`, { headers })
    const membersData = await membersRes.json()
    const charlieMemberRecord = membersData.items[0]
    expect(charlieMemberRecord).toBeDefined()

    await request.patch(`http://localhost:8090/api/collections/room_members/records/${charlieMemberRecord.id}`, {
      headers,
      data: { is_muted: true }
    })

    /* Send a text message in the room */
    const chatInput = page.getByPlaceholder('Type a message...')
    await chatInput.fill('Hello push notifications!')
    await chatInput.press('Enter')

    /* Confirm message is rendered in timeline */
    await expect(page.locator('message-timeline')).toContainText('Hello push notifications!')

    /* Fetch the last dispatched push notification from the mock backend API and assert properties */
    let pushPayload = null
    for (let i = 0; i < 10; i++) {
      const res = await request.get(`http://localhost:8090/api/last-push`, { headers })
      const data = await res.json()
      if (data) {
        pushPayload = data
        break
      }
      await page.waitForTimeout(500)
    }

    expect(pushPayload).not.toBeNull()
    expect(pushPayload.payload).toBeDefined()
    expect(pushPayload.payload.type).toBe('NEW_MESSAGE')
    expect(pushPayload.payload.message_id).toBeDefined()

    /* Assert that Bob is included as a recipient, but Alice (sender) and Charlie (muted) are strictly excluded */
    expect(pushPayload.subscriptions).toBeDefined()
    expect(pushPayload.subscriptions.length).toBe(1)
    expect(pushPayload.subscriptions[0].endpoint).toContain('BOB')
    expect(pushPayload.subscriptions[0].endpoint).not.toContain('ALICE')
    expect(pushPayload.subscriptions[0].endpoint).not.toContain('CHARLIE')
  })
})
