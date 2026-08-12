import { test, expect } from './fixtures/base-test.js'

test.describe('Platform-Agnostic Push Notifications Plugin', () => {
  test.beforeEach(async ({ page }) => {
    /* Enable simulated PushManager support and mock permissions on initial page load */
    await page.addInitScript(() => {
      let currentPermission = 'default'
      Object.defineProperty(window.Notification, 'permission', {
        get () {
          return currentPermission
        },
        configurable: true
      })
      window.Notification.requestPermission = async () => {
        currentPermission = 'granted'
        return 'granted'
      }

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

  test('should request push permissions and register automatically on vault unlock', async ({ page, loginApp, request }) => {
    /* Perform successful login & unlock */
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    /* Verify standard app-layout is visible */
    await expect(page.locator('app-layout')).toBeVisible()

    const testId = await page.evaluate(() => {
      return window.__playwright_test_id__ || 'default'
    })
    const headers = { 'x-test-id': testId }

    /* Assert that the push plugin requested permission and registered automatically on vault unlock */
    let pushRegistered = false
    for (let i = 0; i < 20; i++) {
      const res = await request.get(`http://localhost:8091/api/collections/users/records/alice`, { headers })
      if (res.ok()) {
        const user = await res.json()
        if (user && user.push_subscription) {
          pushRegistered = true
          break
        }
      }
      await page.waitForTimeout(500)
    }

    expect(pushRegistered).toBe(true)

    // Navigate to Settings
    await page.locator('[data-testid="nav-sidebar-0__profileBtn"]').click()
    await page.locator('[data-testid="nav-sidebar-0__btnSettings"]').click()

    // Tap on the Notifications category in settings-pane
    await page.locator('[data-testid="settings-pane-0__nav-notifications"]').click()

    // Find browser notifications switch and assert it is checked by default
    const switchInput = page.locator('notifications-settings input[type="checkbox"]')
    await expect(switchInput).toBeVisible()
    await expect(switchInput).toBeChecked()
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
    await request.patch(`http://localhost:8091/api/collections/users/records/bob`, {
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

    await request.patch(`http://localhost:8091/api/collections/users/records/charlie`, {
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
    await expect(page.locator('atoll-chat-view')).toBeVisible()

    /* Mute Charlie inside the room members database for this testId to assert filtering */
    const membersRes = await request.get(`http://localhost:8091/api/collections/room_members/records?filter=user_id="charlie"`, { headers })
    const membersData = await membersRes.json()
    const charlieMemberRecord = membersData.items[0]
    expect(charlieMemberRecord).toBeDefined()

    await request.post(`http://localhost:8091/api/collections/room_settings/records`, {
      headers,
      data: {
        room_id: charlieMemberRecord.room_id,
        user_id: 'charlie',
        is_muted: true
      }
    })

    /* Send a text message in the room */
    const chatInput = page.locator('atoll-chat-input-text textarea, atoll-chat-input textarea, textarea[placeholder*="message"]').first()
    await chatInput.fill('Hello push notifications!')
    await chatInput.press('Enter')

    /* Confirm message is rendered in timeline */
    await expect(page.locator('atoll-chat-timeline')).toContainText('Hello push notifications!')

    /* Fetch the last dispatched push notification from the mock backend API and assert properties */
    let pushPayload = null
    for (let i = 0; i < 10; i++) {
      const res = await request.get(`http://localhost:8091/api/last-push`, { headers })
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
    expect(pushPayload.recipients).toBeDefined()
    expect(pushPayload.recipients.length).toBe(1)
    expect(pushPayload.recipients[0].subscription.endpoint).toContain('BOB')
    expect(pushPayload.recipients[0].subscription.endpoint).not.toContain('ALICE')
    expect(pushPayload.recipients[0].subscription.endpoint).not.toContain('CHARLIE')
  })

  test('should asynchronously prune stale subscriptions (410/404) via the self-healing webhook', async ({ page, loginApp, request }) => {
    /* Log in as Alice first so that window is loaded and we can retrieve the active E2E testId */
    await loginApp('alice', 'Password123!', 'VaultPassword123!')
    await expect(page.locator('app-layout')).toBeVisible()

    const testId = await page.evaluate(() => {
      return window.__playwright_test_id__ || 'default'
    })

    console.log(`[TEST Self-Healing] Using resolved E2E testId: ${testId}`)
    const headers = { 'x-test-id': testId }

    /* Set up Bob with an "EXPIRED" push subscription endpoint on the backend database */
    await request.patch(`http://localhost:8091/api/collections/users/records/bob`, {
      headers,
      data: {
        push_subscription: {
          endpoint: 'https://updates.push.services.mozilla.com/push/v1/gAAAAAB_BOB_EXPIRED...',
          keys: {
            p256dh: 'BAs=',
            auth: 'c3g='
          }
        }
      }
    })

    /* Create a direct room with Bob */
    await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await expect(page.locator('.modal-title:has-text("Create New Room")')).toBeVisible()

    /* Search and add Bob */
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()

    /* Submitting direct room with Bob (roomNameInput is hidden for direct chats) */
    await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    /* Wait for room list to update and room to be selected */
    await expect(page.locator('atoll-chat-view')).toBeVisible()

    /* Send a text message in the room */
    const chatInput = page.locator('atoll-chat-input-text textarea, atoll-chat-input textarea, textarea[placeholder*="message"]').first()
    await chatInput.fill('Prune this stale sub please!')
    await chatInput.press('Enter')

    /* Confirm message is instantly rendered in timeline (verifying non-blocking/asynchronous transaction finish) */
    await expect(page.locator('atoll-chat-timeline')).toContainText('Prune this stale sub please!')

    /* Wait for self-healing pruning webhook to be called in background and clean Bob's subscription */
    let pruned = false
    for (let i = 0; i < 20; i++) {
      const res = await request.get(`http://localhost:8091/api/collections/users/records/bob`, { headers })
      const user = await res.json()
      if (user && user.push_subscription === null) {
        pruned = true
        break
      }
      await page.waitForTimeout(500)
    }

    expect(pruned).toBe(true)
  })

  test('should mute notification and sound only when active chat is selected AND app is visible', async ({ page, loginApp }) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')
    await expect(page.locator('app-layout')).toBeVisible()

    // Ensure sync is complete before interacting
    await page.waitForFunction(() => window.$bus && !window.$state.isCatchingUp, { timeout: 30000 })

    /* Create a room with Bob */
    await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
    await expect(page.locator('atoll-chat-view')).toBeVisible()

    const roomId = await page.evaluate(() => window.$state.activeSelectionId)
    expect(roomId).toBeDefined()

    /* Stub Notification class and document.visibilityState to return 'visible' */
    await page.evaluate(() => {
      window.__notif_dispatched__ = false
      window.Notification = class extends EventTarget {
        constructor () {
          super()
          window.__notif_dispatched__ = true
        }

        static permission = 'granted'
      }

      Object.defineProperty(document, 'visibilityState', {
        get () {
          return 'visible'
        },
        configurable: true
      })
    })

    /* Simulate incoming message for active room when app IS visible */
    await page.evaluate(({ roomId }) => {
      window.$bus.emit('db:new_local_data', {
        room_id: roomId,
        message: {
          id: 'msg-visible-1',
          sender_id: 'bob',
          type: 'text',
          content: 'Message while visible'
        }
      })
    }, { roomId })

    const wasDispatchedWhenVisible = await page.evaluate(() => window.__notif_dispatched__)
    expect(wasDispatchedWhenVisible).toBe(false)

    /* Reset flag and stub document.visibilityState to return 'hidden' (app NOT visible) */
    await page.evaluate(() => {
      window.__notif_dispatched__ = false
      Object.defineProperty(document, 'visibilityState', {
        get () {
          return 'hidden'
        },
        configurable: true
      })
    })

    /* Simulate incoming message for active room when app is NOT visible */
    await page.evaluate(({ roomId }) => {
      window.$bus.emit('db:new_local_data', {
        room_id: roomId,
        message: {
          id: 'msg-hidden-1',
          sender_id: 'bob',
          type: 'text',
          content: 'Message while hidden'
        }
      })
    }, { roomId })

    await expect.poll(async () => {
      return await page.evaluate(() => window.__notif_dispatched__)
    }).toBe(true)
  })

  test('should suppress unread badge and automatically mark new message as read when active on the room', async ({ page, loginApp }) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')
    await expect(page.locator('app-layout')).toBeVisible()

    // Ensure sync is complete before interacting
    await page.waitForFunction(() => window.$bus && !window.$state.isCatchingUp, { timeout: 30000 })

    /* Create a room with Bob */
    await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
    await expect(page.locator('atoll-chat-view')).toBeVisible()

    const roomId = await page.evaluate(() => window.$state.activeSelectionId)
    expect(roomId).toBeDefined()

    /* Verify there is no unread badge initially on the active chat-list-item */
    const chatListItem = page.locator(`chat-list-item[room-id="${roomId}"]`)
    await expect(chatListItem).toBeVisible()
    await expect(chatListItem).toHaveAttribute('is-unread', 'false')
    await expect(chatListItem).toHaveAttribute('unread-count', '0')

    /* Simulate incoming message from Bob for this active room */
    await page.evaluate(async ({ roomId }) => {
      const msg = {
        id: 'msg-active-read-1',
        local_uuid: 'uuid-active-read-1',
        room_id: roomId,
        sender_id: 'bob',
        type: 'text',
        content: 'Message for active room',
        created_at: new Date().toISOString(),
        status: 'sent'
      }
      await window.$localDb.local_messages.put(msg)
      window.$bus.emit('db:new_local_data', {
        room_id: roomId,
        message: msg
      })
    }, { roomId })

    /* Give a small timeout for database/event updates */
    await page.waitForTimeout(500)

    /* Verify that the badge and counts are STILL suppressed in the UI (is-unread is false, count is 0) */
    await expect(chatListItem).toHaveAttribute('is-unread', 'false')
    await expect(chatListItem).toHaveAttribute('unread-count', '0')

    /* Verify that the message was saved and actually marked as read (last_read_message_id is updated to 'msg-active-read-1') */
    const lastReadMsgId = await page.evaluate(async ({ roomId }) => {
      const room = await window.$localDb.local_rooms.get(roomId)
      const me = room?.participants?.find(p => p.id === window.$state.currentUser?.id)
      return me?.last_read_message_id
    }, { roomId })

    expect(lastReadMsgId).toBe('msg-active-read-1')
  })
})
