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
    await loginApp('alice', 'Password123!', 'Password123!')
    await expect(page.locator('app-layout')).toBeVisible()

    // Create a room to ensure a valid selected room exists
    await page.locator('[data-testid$="btnCreateRoom"]').click()
    await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid$="btnCreate"]').click()
    await expect(page.locator('atoll-chat-view')).toBeVisible()

    const roomId = await page.locator('atoll-chat-view').getAttribute('data-room-id') || await page.evaluate(() => window.$state.activeSelectionId)
    expect(roomId).toBeDefined()

    await page.locator('[data-testid$="profileBtn"]').click()
    await page.locator('[data-testid$="btnSettings"]').click()

    // Assert that we are in settings and NOT in the room
    await expect(page.locator('settings-main')).toBeVisible()

    // Spy on window.focus
    await page.evaluate(() => {
      window.__window_focused__ = false
      const origFocus = window.focus
      window.focus = function () {
        window.__window_focused__ = true
        if (typeof origFocus === 'function') {
          origFocus.apply(this, arguments)
        }
      }
    })

    // Dispatch real Service Worker NOTIFICATION_CLICKED message event
    await page.evaluate(({ roomId }) => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'NOTIFICATION_CLICKED',
            payload: {
              room_id: roomId,
              messageId: 'test-msg-123'
            }
          }
        }))
      }
    }, { roomId })

    // Wait and assert that window.focus was called and we navigated back to chats UI view
    const focusCalled = await page.evaluate(() => window.__window_focused__)
    expect(focusCalled).toBe(true)

    await expect(page.locator('atoll-chat-view')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('settings-main')).not.toBeVisible()
  })

  test('should navigate and scroll to message on cold boot when URL query parameters are present', async ({ page, loginApp }) => {
    // Perform successful login & unlock first to establish a valid room & message
    await loginApp('alice', 'Password123!', 'Password123!')
    await expect(page.locator('app-layout')).toBeVisible()

    // Create a room with Bob
    await page.locator('[data-testid$="btnCreateRoom"]').click()
    await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid$="btnCreate"]').click()
    await expect(page.locator('atoll-chat-view')).toBeVisible()

    const roomId = await page.evaluate(() => window.$state.activeSelectionId)
    expect(roomId).toBeDefined()

    // Send a text message in the room
    const chatInput = page.getByPlaceholder('Type a message...')
    await chatInput.fill('Cold boot test message')
    await chatInput.press('Enter')
    await expect(page.locator('atoll-chat-timeline')).toContainText('Cold boot test message')

    // Wait until the message has been fully synced and assigned its database ID
    const lastRow = page.locator('atoll-chat-timeline-row').last()
    await expect(lastRow).toHaveAttribute('data-message-id', /.+/)
    const messageId = await lastRow.getAttribute('data-message-id')

    expect(messageId).not.toBeNull()
    expect(messageId).not.toBeUndefined()
    expect(messageId).not.toBe('')

    // Load the app with the specific notification destination URL parameters to simulate cold boot
    const targetUrl = `/?view=chats&id=${roomId}&type=chats&messageId=${messageId}`
    await page.goto(targetUrl)

    // Wait for hydration
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    // Since the session is preserved, we should see the Unlock Vault page
    await expect(page.locator('vault-unlock')).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible({ timeout: 15000 })

    // Unlock the vault
    await page.locator('vault-unlock input[data-testid$="password"]').fill('Password123!')
    await page.locator('vault-unlock [data-testid$="unlockSubmit"]').click()

    // Wait for the app-layout/chats view to load, and verify navigation & message visibility
    await expect(page.locator('app-layout')).toBeVisible()
    await expect(page.locator('atoll-chat-view')).toBeVisible({ timeout: 10000 })
    await expect(page.locator(`atoll-chat-timeline-row[data-message-id="${messageId}"]`)).toBeVisible()
  })
})
