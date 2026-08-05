import { test, expect } from './fixtures/base-test.js'

test.describe('Messaging Features', () => {

  test.describe('Chat Actions', () => {
    test.beforeEach(async ({ page, loginApp }) => {
      test.slow()
      await loginApp('alice', 'Password123!', 'VaultPassword123!')
      await page.locator('[data-testid$="btnCreateRoom"]').click()
      await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid$="btnCreate"]').click()
      await page.fill('textarea', 'Msg 1')
      await page.keyboard.press('Enter')
      await page.locator('[data-testid$="btnCreateRoom"]').click()
      await page.locator('create-room-modal [data-testid$="searchInput"]').fill('charlie')
      await page.locator('[data-testid$="search-result-charlie"]').click()
      await page.locator('[data-testid$="btnCreate"]').click()
    })

    test('mark as unread, mute, delete', async ({ page }) => {
      // Ensure sync is complete before interacting
      await page.waitForFunction(() => window.$bus && !window.$state.isCatchingUp, { timeout: 30000 })

      const getBobChat = () => page.locator('chat-list-item').filter({ hasText: /bob/i })
      await expect(getBobChat()).toBeVisible({ timeout: 30000 })

      console.log('Toggling read status...')
      await getBobChat().locator('atoll-list-item').click({ button: 'right' })
      const toggleReadItem = page.locator('[data-testid="context-item-mark-as-unread"], [data-testid="context-item-mark-as-read"]').first()
      await toggleReadItem.click()

      // Wait for success toast to ensure operation finished
      await expect(page.locator('.toast')).toContainText(/Marked as unread|Marked as read/, { timeout: 20000 })

      // Verification: Dropdown label should have flipped
      await getBobChat().locator('atoll-list-item').click({ button: 'right' })
      await expect(page.locator('[data-testid="context-item-mark-as-unread"], [data-testid="context-item-mark-as-read"]').first()).toBeVisible({ timeout: 15000 })
      // Dismiss context menu
      await page.keyboard.press('Escape')

      console.log('Toggling mute status...')
      await getBobChat().locator('atoll-list-item').click({ button: 'right' })
      await page.locator('[data-testid="context-item-mute-notifications"]').click()
      await expect(page.locator('.toast')).toContainText('Notifications muted')

      page.once('dialog', dialog => dialog.accept())
      await getBobChat().locator('atoll-list-item').click({ button: 'right' })
      await page.locator('[data-testid="context-item-delete-chat"]').click()
      await expect(page.locator('chat-list-item').filter({ hasText: /bob/i })).toHaveCount(0)
    })
  })

  test.describe('Timeline Behavior', () => {
    test('auto-scroll and focus persistence', async ({ browser, loginCustomPage }) => {
      test.slow()
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')

      await alicePage.locator('[data-testid$="btnCreateRoom"]').click()
      await alicePage.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await alicePage.locator('[data-testid$="search-result-bob"]').click()
      await alicePage.locator('[data-testid$="btnCreate"]').click()

      const aliceInput = alicePage.locator('textarea[placeholder="Type a message..."]')
      for (let i = 0; i < 25; i++) {
        await aliceInput.fill(`Msg ${i}`)
        await alicePage.keyboard.press('Enter')
        // Give it a moment to process
        await alicePage.waitForTimeout(100)
      }
      // Ensure messages are rendered
      await expect(alicePage.locator('timeline-row').last()).toContainText('Msg 24', { timeout: 20000 })

      const timeline = alicePage.locator('message-timeline div.overflow-auto').first()
      await timeline.evaluate(el => el.scrollTop = 0)
      // Wait for debounce and scroll to settle
      await alicePage.waitForTimeout(1000)

      await aliceInput.fill('Jump')
      await alicePage.keyboard.press('Enter')
      // Wait for smooth scroll to finish
      await alicePage.waitForTimeout(3000)
      const scrollTop = await timeline.evaluate(el => el.scrollTop)
      const scrollHeight = await timeline.evaluate(el => el.scrollHeight)
      const clientHeight = await timeline.evaluate(el => el.clientHeight)
      expect(scrollTop).toBeGreaterThan(scrollHeight - clientHeight - 100)
      await expect(aliceInput).toBeFocused()

      await aliceContext.close()
    })

    test('message ordering', async ({ page, loginApp }) => {
      test.slow()
      await loginApp('alice', 'Password123!', 'VaultPassword123!')
      await page.locator('[data-testid$="btnCreateRoom"]').click()
      await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid$="btnCreate"]').click()
      await expect(page.locator('chat-view')).toBeVisible()

      await page.evaluate(async () => {
        const room_id = window.$state.activeSelectionId
        const now = Date.now()
        const msg1 = {
          local_uuid: 'm1',
          room_id,
          sender_id: window.$state.currentUser.id,
          type: 'text',
          content: 'New',
          created_at: new Date(now).toISOString(),
          status: 'sent'
        }
        const msg2 = {
          local_uuid: 'm2',
          room_id,
          sender_id: window.$state.currentUser.id,
          type: 'text',
          content: 'Old',
          created_at: new Date(now - 10000).toISOString(),
          status: 'sent'
        }
        await window.$localDb.local_messages.put(msg2)
        window.$bus.emit('db:new_local_data', {
          room_id,
          message: msg2
        })
        await window.$localDb.local_messages.put(msg1)
        window.$bus.emit('db:new_local_data', {
          room_id,
          message: msg1
        })
      })
      await expect(page.locator('timeline-row').first()).toContainText('Old')
      await expect(page.locator('timeline-row').last()).toContainText('New')
    })

    test('message bubble roundness strategy', async ({ page, loginApp }) => {
      test.slow()
      await loginApp('alice', 'Password123!', 'VaultPassword123!')
      await page.locator('[data-testid$="btnCreateRoom"]').click()
      await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid$="btnCreate"]').click()
      await expect(page.locator('chat-view')).toBeVisible()

      // Send 3 consecutive text messages
      const textarea = page.locator('textarea[placeholder="Type a message..."]')
      await textarea.fill('Hello 1')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)

      await textarea.fill('Hello 2')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)

      await textarea.fill('Hello 3')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1000)

      const rows = page.locator('timeline-row')
      await expect(rows).toHaveCount(3)

      // The first should be is-first-in-block="true" and is-last-in-block="false"
      await expect(rows.nth(0)).toHaveAttribute('is-first-in-block', 'true')
      await expect(rows.nth(0)).toHaveAttribute('is-last-in-block', 'false')

      // The second should be is-first-in-block="false" and is-last-in-block="false"
      await expect(rows.nth(1)).toHaveAttribute('is-first-in-block', 'false')
      await expect(rows.nth(1)).toHaveAttribute('is-last-in-block', 'false')

      // The third should be is-first-in-block="false" and is-last-in-block="true"
      await expect(rows.nth(2)).toHaveAttribute('is-first-in-block', 'false')
      await expect(rows.nth(2)).toHaveAttribute('is-last-in-block', 'true')
    })
  })

  test.describe('Content Rendering', () => {
    test('comprehensive markdown', async ({ page, loginCustomPage }) => {
      test.slow()
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      await page.locator('[data-testid$="btnCreateRoom"]').click()
      await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid$="btnCreate"]').click()
      const md = '# H1\n## H2\n**B**\n*I*\n- L\n> Q\n`C`\n\n| T | H |\n|---|---|\n| R | V |\n\n[G](https://google.com)'
      await page.fill('textarea', md)
      await page.click('[data-testid$="__sendButton"]')
      const row = page.locator('timeline-row').filter({ hasText: 'H1' })
      await expect(row.locator('h1')).toHaveText('H1')
      await expect(row.locator('h2')).toHaveText('H2')
      await expect(row.locator('strong')).toHaveText('B')
      await expect(row.locator('em')).toHaveText('I')
      await expect(row.locator('li')).toContainText('L')
      await expect(row.locator('blockquote')).toContainText('Q')
      await expect(row.locator('code').first()).toHaveText('C')
      await expect(row.locator('table')).toBeVisible()
      await expect(row.locator('a:has-text("G")')).toBeVisible()
    })

    test('link previews', async ({ page, loginCustomPage }) => {
      test.slow()
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      await page.locator('[data-testid$="btnCreateRoom"]').click()
      await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid$="btnCreate"]').click()
      await page.fill('textarea', 'https://google.com https://github.com ')
      await expect(page.locator('ui-link-preview-input')).toHaveCount(2, { timeout: 15000 })
      await page.locator('ui-link-preview-input').first().locator('button[title="Dismiss preview"]').click()
      await expect(page.locator('ui-link-preview-input')).toHaveCount(1)
      await page.click('[data-testid$="__sendButton"]')
      await expect(page.locator('timeline-item-link')).toHaveCount(1)
    })
  })

  test.describe('Interaction & Features', () => {
    test('message reactions', async ({ browser, loginCustomPage }) => {
      test.slow()
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      const bobContext = await browser.newContext()
      const bobPage = await bobContext.newPage()
      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
      await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
      await alicePage.locator('[data-testid$="btnCreateRoom"]').click()
      await alicePage.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await alicePage.locator('[data-testid$="search-result-bob"]').click()
      await alicePage.locator('[data-testid$="btnCreate"]').click()
      const msg = 'React ' + Date.now()
      await alicePage.fill('textarea', msg)
      await alicePage.click('[data-testid$="__sendButton"]')
      const bobChat = bobPage.locator('chat-list chat-list-item').filter({ hasText: 'alice' }).first()
      await expect(bobChat).toBeVisible({ timeout: 30000 })
      await bobChat.locator('atoll-list-item').click()
      const row = bobPage.locator('timeline-row').filter({ hasText: msg })
      await expect(row).toBeVisible({ timeout: 20000 })
      const uuid = await row.getAttribute('data-local-uuid')
      await bobPage.evaluate(({ uuid }) => {
        window.$bus.emit('message:send_reaction', {
          targetId: uuid,
          content: {
            type: 'emoji',
            value: '👍'
          }
        })
      }, { uuid })
      await expect(row.locator('.reaction-consolidated-pill')).toBeVisible({ timeout: 15000 })
      const alicePill = alicePage.locator('timeline-row').filter({ hasText: msg }).locator('.reaction-consolidated-pill')
      await alicePill.click()
      await expect(alicePill.locator('.reaction-count')).toHaveText('2', { timeout: 15000 })
      await aliceContext.close()
      await bobContext.close()
    })

    test('search and notifications', async ({ browser, page, loginCustomPage }) => {
      test.slow()
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      await page.locator('[data-testid$="btnCreateRoom"]').click()
      await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('create-room-modal [data-testid$="searchInput"]').fill('charlie')
      await page.locator('[data-testid$="search-result-charlie"]').click()
      await page.locator('[data-testid$="roomNameInput"]').fill('Project X')
      await page.locator('[data-testid$="btnCreate"]').click()

      // Wait for room to appear in list
      await expect(page.locator('chat-list chat-list-item:has-text("Project X")')).toBeVisible({ timeout: 15000 })

      await page.locator('list-pane [data-testid$="searchInput"]').fill('Project')
      await expect(page.locator('chat-list chat-list-item:has-text("Project X")')).toBeVisible()

      // Debounce sound
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      const bobContext = await browser.newContext()
      const bobPage = await bobContext.newPage()
      await alicePage.addInitScript(() => {
        window.playCount = 0
        window.Audio = class extends window.Audio {
          play () {
            window.playCount++; return Promise.resolve()
          }
        }
      })
      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
      await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
      await bobPage.locator('[data-testid$="btnCreateRoom"]').click()
      await bobPage.locator('create-room-modal [data-testid$="searchInput"]').fill('alice')
      await bobPage.locator('[data-testid$="search-result-alice"]').click()
      await bobPage.locator('[data-testid$="btnCreate"]').click()
      for (let i = 0; i < 3; i++) {
        await bobPage.fill('textarea', `M ${i}`)
        await bobPage.keyboard.press('Enter')
      }
      await alicePage.waitForTimeout(2000)
      expect(await alicePage.evaluate(() => window.playCount)).toBe(1)
      await aliceContext.close()
      await bobContext.close()
    })
  })

  test.describe('Mobile Keyboard and Focus Management', () => {
    // Emulate a mobile device with touch input
    test.use({
      viewport: {
        width: 375,
        height: 667
      },
      hasTouch: true,
      isMobile: true
    })

    test('should not auto-focus the input on mobile and should lose focus after sending', async ({ page, loginApp }) => {
      test.slow()

      await loginApp('alice', 'Password123!', 'VaultPassword123!')

      // Create a room
      await page.locator('[data-testid$="btnCreateRoom"]').click()
      await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid$="btnCreate"]').click()

      await expect(page.locator('chat-view')).toBeVisible({ timeout: 15000 })

      const textarea = page.locator('textarea[placeholder="Type a message..."]')
      await expect(textarea).toBeVisible()

      // On initial load / programmatic transitions, textarea should NOT be focused on mobile
      await expect(textarea).not.toBeFocused()

      // Explicitly tap the textarea to focus it (virtual keyboard pops up)
      await textarea.click()
      await expect(textarea).toBeFocused()

      // Take screenshot of the focused state
      await page.screenshot({ path: './tests/e2e/screenshots/focused.png' })

      // Send a message
      await textarea.fill('Hello from emulated touch device!')

      // Click the send button to simulate mobile tap
      await page.click('[data-testid$="__sendButton"]')

      // Verify that the input loses focus (textarea.blur() was triggered)
      await expect(textarea).not.toBeFocused({ timeout: 5000 })
    })
  })

  test.describe('Network Resiliency & Offline Queuing', () => {
    test('should queue messages offline and automatically flush them when online', async ({ page, loginApp }) => {
      test.slow()
      await loginApp('alice', 'Password123!', 'VaultPassword123!')

      // Create a room
      await page.locator('[data-testid$="btnCreateRoom"]').click()
      await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid$="btnCreate"]').click()

      await expect(page.locator('chat-view')).toBeVisible({ timeout: 15000 })

      // Send an initial online message to trigger and cache all dynamic components
      const textarea = page.locator('textarea[placeholder="Type a message..."]')
      await textarea.fill('Warmup online message')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1000)

      // Verify isOnline is true and offline banner is hidden initially
      const banner = page.locator('.offline-banner')
      await expect(banner).toBeHidden()

      // Transition to offline state
      await page.context().setOffline(true)
      await page.waitForTimeout(1000)

      // Verify the banner is now visible
      await expect(banner).toBeVisible()

      // Compose and send an offline message
      await textarea.fill('Offline message!')
      await page.keyboard.press('Enter')

      // Verify the message immediately appears on the timeline with the "pending" visual treatment (opacity-75 class)
      const lastRow = page.locator('timeline-row').last()
      await expect(lastRow).toContainText('Offline message!')
      await expect(lastRow).toHaveClass(/opacity-75/)

      // Verify the global status indicator shows a clock icon
      const statusIcon = page.locator('message-timeline .message-status-container atoll-icon')
      await expect(statusIcon).toHaveAttribute('name', 'clock')

      // Transition back to online state
      await page.context().setOffline(false)
      await page.waitForTimeout(2000)

      // Verify the offline banner is hidden again
      await expect(banner).toBeHidden()

      // Verify the message is successfully flushed, sent to the server, and updated from "pending" to "sent" (no opacity-75 class, showing check icon)
      await expect(lastRow).not.toHaveClass(/opacity-75/, { timeout: 15000 })
      await expect(statusIcon).toHaveAttribute('name', 'check', { timeout: 15000 })
    })
  })

  test.describe('Foreground Sync Concurrency', () => {
    test('should reuse ongoing catch-up synchronization promise on multiple concurrent foreground events', async ({ page, loginApp }) => {
      test.slow()

      const consoleLogs = []
      page.on('console', msg => {
        consoleLogs.push(msg.text())
      })

      await loginApp('alice', 'Password123!', 'VaultPassword123!')

      // Ensure initial sync is fully complete
      await page.waitForFunction(() => window.$bus && !window.$state.isCatchingUp, { timeout: 30000 })

      // Trigger app:foreground multiple times in rapid succession
      await page.evaluate(() => {
        window.$bus.emit('app:foreground')
        window.$bus.emit('app:foreground')
        window.$bus.emit('app:foreground')
      })

      // Wait a moment for async execution
      await page.waitForTimeout(2000)

      // Ensure that our concurrency guard message was printed in console
      const reuseLogs = consoleLogs.filter(log => log.includes('[sync-plugin] Catch-up synchronization already in progress. Reusing existing promise.'))
      expect(reuseLogs.length).toBeGreaterThanOrEqual(1)

      // Ensure catch-up is done and no errors were thrown
      await page.waitForFunction(() => !window.$state.isCatchingUp, { timeout: 15000 })
      const errorLogs = consoleLogs.filter(log => log.includes('Foreground sync catch-up failed') || log.includes('Critical failure during historical catch-up'))
      expect(errorLogs.length).toBe(0)
    })
  })
})
