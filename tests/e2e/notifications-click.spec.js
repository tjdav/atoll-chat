import { test, expect } from './fixtures/base-test.js'

test.describe('Notification Click Navigation & Logo Tests', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', err => {
      console.log('--- TEST BROWSER PAGE ERROR STACK ---')
      console.log(err.stack || err.message || err)
      console.log('------------------------------------')
    })
  })

  test('should navigate and scroll to message when a Service Worker notification is clicked (active app)', async ({ page, loginApp }) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')
    await expect(page.locator('app-layout')).toBeVisible()

    // Create a room to ensure a valid selected room exists
    await page.locator('[data-testid$="btnCreateRoom"]').click()
    await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid$="btnCreate"]').click()
    await expect(page.locator('chat-view')).toBeVisible()

    const roomId = await page.evaluate(() => {
      return window.$state.activeSelectionId
    })
    expect(roomId).toBeDefined()

    await page.locator('[data-testid$="profileBtn"]').click()
    await page.locator('[data-testid$="btnSettings"]').click()

    // Assert that we are in settings and NOT in the room
    await expect(page.locator('settings-main')).toBeVisible()

    // Listen for the scroll to event to verify it's triggered
    await page.evaluate(() => {
      window.__test_message_scroll_requested = false
      window.$bus.on('message:scroll_to', (payload) => {
        if (payload && payload.messageId === 'test-msg-123') {
          window.__test_message_scroll_requested = true
        }
      })
    })

    // Simulate notification click using our exposed window helper
    await page.evaluate(({ roomId }) => {
      window.__simulateNotificationClick(roomId, 'test-msg-123')
    }, { roomId })

    // Wait and assert that we navigated back to chats and selected the correct room
    await page.waitForFunction(() => window.$state.currentAppView === 'chats')
    const activeId = await page.evaluate(() => window.$state.activeSelectionId)
    expect(activeId).toBe(roomId)

    // Verify the message:scroll_to was fired
    await page.waitForFunction(() => window.__test_message_scroll_requested === true, null, { timeout: 5000 })
    const scrollRequested = await page.evaluate(() => window.__test_message_scroll_requested)
    expect(scrollRequested).toBe(true)
  })

  test('should navigate and scroll to message on cold boot when URL query parameters are present', async ({ page, loginApp }) => {
    // 1. Perform successful login & unlock first to establish a valid room & message
    await loginApp('alice', 'Password123!', 'VaultPassword123!')
    await expect(page.locator('app-layout')).toBeVisible()

    // Create a room with Bob
    await page.locator('[data-testid$="btnCreateRoom"]').click()
    await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid$="btnCreate"]').click()
    await expect(page.locator('chat-view')).toBeVisible()

    const roomId = await page.evaluate(() => window.$state.activeSelectionId)
    expect(roomId).toBeDefined()

    // Send a text message in the room
    const chatInput = page.getByPlaceholder('Type a message...')
    await chatInput.fill('Cold boot test message')
    await chatInput.press('Enter')
    await expect(page.locator('message-timeline')).toContainText('Cold boot test message')

    // Wait until the message has been fully synced and assigned its database ID
    const lastRow = page.locator('timeline-row').last()
    await expect(lastRow).toHaveAttribute('data-message-id', /.+/)
    const messageId = await lastRow.getAttribute('data-message-id')

    console.log('[TEST DEBUG] roomId is:', roomId)
    console.log('[TEST DEBUG] messageId is:', messageId)

    expect(messageId).not.toBeNull()
    expect(messageId).not.toBeUndefined()
    expect(messageId).not.toBe('')

    // 2. Load the app with the specific notification destination URL parameters to simulate cold boot
    const targetUrl = `/?view=chats&id=${roomId}&type=chats&messageId=${messageId}`
    console.log('[TEST DEBUG] Navigating to URL:', targetUrl)
    await page.goto(targetUrl)

    // 3. Wait for hydration
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    // 4. Since the session is preserved, we should see the Unlock Vault page
    await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible({ timeout: 15000 })

    // Set up scroll_to spy/hook on the bus
    await page.evaluate(({ messageId }) => {
      window.__test_message_scroll_requested = false
      window.$bus.on('message:scroll_to', (payload) => {
        if (payload && payload.messageId === messageId) {
          window.__test_message_scroll_requested = true
        }
      })
    }, { messageId })

    // 5. Unlock the vault
    await page.locator('vault-unlock [data-testid$="password"]').fill('VaultPassword123!')
    await page.locator('vault-unlock [data-testid$="unlockSubmit"]').click()

    // 6. Wait for the app-layout/chats view to load, and verify navigation
    await expect(page.locator('app-layout')).toBeVisible()

    await page.waitForFunction(() => window.$state.currentAppView === 'chats')
    const activeId = await page.evaluate(() => window.$state.activeSelectionId)
    expect(activeId).toBe(roomId)

    // 7. Verify message:scroll_to was triggered after vault unlock
    await page.waitForFunction(() => window.__test_message_scroll_requested === true, null, { timeout: 10000 })
    const scrollRequested = await page.evaluate(() => window.__test_message_scroll_requested)
    expect(scrollRequested).toBe(true)
  })
})
