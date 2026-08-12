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

    test('mute and delete room via room settings offcanvas', async ({ page }) => {
      // Ensure sync is complete before interacting
      await page.waitForFunction(() => window.$bus && !window.$state.isCatchingUp, { timeout: 30000 })

      const getBobChat = () => page.locator('chat-list-item').filter({ hasText: /bob/i })
      await expect(getBobChat()).toBeVisible({ timeout: 30000 })
      await getBobChat().click()

      console.log('Opening Room Settings offcanvas...')
      await page.locator('[ref$="btnDetails"] button').click()
      const offcanvas = page.locator('[data-testid$="roomDetailsOffcanvas"]')
      await expect(offcanvas).toBeVisible()
      await expect(offcanvas.locator('[ref$="roomNameText"]')).toContainText('bob')

      console.log('Toggling mute status...')
      await page.locator('[data-testid$="accordion-privacy-btn"]').click()
      const muteBadge = page.locator('[ref$="muteStatusBadge"]')
      await expect(muteBadge).toContainText('Off')
      await page.locator('[data-testid$="btnMuteNotifications"]').getByRole('button').click()
      await expect(muteBadge).toContainText('On')

      console.log('Deleting chat...')
      page.once('dialog', dialog => dialog.accept())
      await page.locator('.overflow-y-auto').first().evaluate(el => el.scrollTop = el.scrollHeight)
      await page.locator('[data-testid$="btnDelete"]').getByRole('button').click()
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
      await expect(alicePage.locator('atoll-chat-timeline-row').last()).toContainText('Msg 24', { timeout: 20000 })

      const timeline = alicePage.locator('atoll-chat-timeline div.overflow-auto').first()
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
      await expect(page.locator('atoll-chat-view')).toBeVisible()

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
      await expect(page.locator('atoll-chat-timeline-row').first()).toContainText('Old')
      await expect(page.locator('atoll-chat-timeline-row').last()).toContainText('New')
    })

    test('message bubble roundness strategy', async ({ page, loginApp }) => {
      test.slow()
      await loginApp('alice', 'Password123!', 'VaultPassword123!')
      await page.locator('[data-testid$="btnCreateRoom"]').click()
      await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid$="btnCreate"]').click()
      await expect(page.locator('atoll-chat-view')).toBeVisible()

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

      const rows = page.locator('atoll-chat-timeline-row')
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
      const row = page.locator('atoll-chat-timeline-row').filter({ hasText: 'H1' })
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
      await expect(page.locator('atoll-chat-timeline-item-link')).toHaveCount(1)
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
      const row = bobPage.locator('atoll-chat-timeline-row').filter({ hasText: msg })
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
      await expect(row.locator('.atoll-chat-reaction-consolidated-pill')).toBeVisible({ timeout: 15000 })
      const alicePill = alicePage.locator('atoll-chat-timeline-row').filter({ hasText: msg }).locator('.atoll-chat-reaction-consolidated-pill')
      await alicePill.click()
      await expect(alicePill.locator('.atoll-chat-reaction-count')).toHaveText('2', { timeout: 15000 })
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

      await expect(page.locator('atoll-chat-view')).toBeVisible({ timeout: 15000 })

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

    test('should show the chat list first on mobile when clicking the chat icon, rather than jumping straight to the chat view', async ({ page, loginApp }) => {
      test.slow()

      await loginApp('alice', 'Password123!', 'VaultPassword123!')

      // Create a room
      await page.locator('[data-testid$="btnCreateRoom"]').click()
      await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid$="btnCreate"]').click()

      await expect(page.locator('atoll-chat-view')).toBeVisible({ timeout: 15000 })

      // Open the mobile navigation offcanvas first by clicking back button in header
      await page.locator('[data-testid$="chatBackBtn"]').click()

      // Open profile dropdown and navigate to Settings on mobile
      await page.locator('[data-testid$="profileBtn"]').click()
      await page.locator('[data-testid$="btnSettings"]').click()

      // Verify settings list pane is loaded and mobileNav is visible
      await expect(page.locator('settings-pane')).toBeVisible()
      await expect(page.locator('[data-testid$="mobileNav"]')).toBeVisible()

      // Click the chats button in the sidebar on mobile
      await page.locator('[data-testid$="btnChats"]').click()

      // Verify that mobileNav (the offcanvas list pane) is STILL visible
      await expect(page.locator('[data-testid$="mobileNav"]')).toBeVisible()

      // Click on the chat-list-item in the list pane
      await page.locator('chat-list-item').first().click()

      // Verify that mobileNav is now hidden and we navigated to the chat view
      await expect(page.locator('[data-testid$="mobileNav"]')).toBeHidden()
      await expect(page.locator('atoll-chat-view')).toBeVisible()
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

      await expect(page.locator('atoll-chat-view')).toBeVisible({ timeout: 15000 })

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
      const lastRow = page.locator('atoll-chat-timeline-row').last()
      await expect(lastRow).toContainText('Offline message!')
      await expect(lastRow).toHaveClass(/opacity-75/)

      // Verify the global status indicator shows a clock icon
      const statusIcon = page.locator('atoll-chat-timeline .atoll-chat-message-status-container atoll-icon')
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

      // Ensure that our concurrency guard was triggered and catchUpPromise was reused
      const isReused = await page.evaluate(() => window.__sync_reused__)
      expect(isReused).toBe(true)

      // Ensure catch-up is done and no errors were thrown
      await page.waitForFunction(() => !window.$state.isCatchingUp, { timeout: 15000 })
      const errorLogs = consoleLogs.filter(log => log.includes('Foreground sync catch-up failed') || log.includes('Critical failure during historical catch-up'))
      expect(errorLogs.length).toBe(0)
    })
  })

  test.describe('Bubble Grouping & Spacing Verification', () => {
    test('private chat bubble grouping and spacing (sent and received)', async ({ browser, loginCustomPage }) => {
      test.slow()

      // Set up Alice's browser context and page
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')

      // Set up Bob's browser context and page
      const bobContext = await browser.newContext()
      const bobPage = await bobContext.newPage()
      await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

      // Alice creates a private chat room with Bob
      await alicePage.locator('[data-testid$="btnCreateRoom"]').click()
      await alicePage.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await alicePage.locator('[data-testid$="search-result-bob"]').click()
      await alicePage.locator('[data-testid$="btnCreate"]').click()

      // Wait for room to be created and active
      await expect(alicePage.locator('atoll-chat-view')).toBeVisible()

      // Alice sends 2 consecutive messages
      const aliceInput = alicePage.locator('textarea[placeholder="Type a message..."]')
      await aliceInput.fill('Hi Bob 1')
      await alicePage.keyboard.press('Enter')
      await alicePage.waitForTimeout(500)

      await aliceInput.fill('Hi Bob 2')
      await alicePage.keyboard.press('Enter')
      await alicePage.waitForTimeout(1000)

      // Verify Alice's sent messages in her timeline
      const aliceRows = alicePage.locator('atoll-chat-timeline-row')
      await expect(aliceRows).toHaveCount(2)

      // Alice's 1st message: is-first-in-block="true", is-last-in-block="false", spacing mb-1
      const firstSentRow = aliceRows.nth(0)
      await expect(firstSentRow).toHaveAttribute('is-first-in-block', 'true')
      await expect(firstSentRow).toHaveAttribute('is-last-in-block', 'false')
      const firstSentRowClass = await firstSentRow.evaluate(el => el.querySelector('.atoll-chat-timeline-row')?.className || '')
      expect(firstSentRowClass).toContain('mb-1')

      // Alice's 2nd message: is-first-in-block="false", is-last-in-block="true", spacing mb-3
      const secondSentRow = aliceRows.nth(1)
      await expect(secondSentRow).toHaveAttribute('is-first-in-block', 'false')
      await expect(secondSentRow).toHaveAttribute('is-last-in-block', 'true')
      const secondSentRowClass = await secondSentRow.evaluate(el => el.querySelector('.atoll-chat-timeline-row')?.className || '')
      expect(secondSentRowClass).toContain('mb-3')

      // Bob clicks on the room with Alice in his chat list
      const getAliceChatInBobList = bobPage.locator('chat-list-item').filter({ hasText: /alice/i })
      await expect(getAliceChatInBobList).toBeVisible({ timeout: 30000 })
      await getAliceChatInBobList.click()
      await expect(bobPage.locator('atoll-chat-view')).toBeVisible()

      // Bob sends 2 consecutive messages
      const bobInput = bobPage.locator('textarea[placeholder="Type a message..."]')
      await bobInput.fill('Hi Alice 1')
      await bobPage.keyboard.press('Enter')
      await bobPage.waitForTimeout(500)

      await bobInput.fill('Hi Alice 2')
      await bobPage.keyboard.press('Enter')
      await bobPage.waitForTimeout(1000)

      // Verify Alice's received Bob's messages on Alice's page
      // There should be 4 messages in Alice's timeline total (2 from Alice, 2 from Bob)
      await expect(aliceRows).toHaveCount(4)

      // Bob's 1st message (received by Alice): is-first-in-block="true", is-last-in-block="false", has sender-name, no avatar, spacing mb-1
      const firstRecvRow = aliceRows.nth(2)
      await expect(firstRecvRow).toHaveAttribute('is-first-in-block', 'true')
      await expect(firstRecvRow).toHaveAttribute('is-last-in-block', 'false')
      await expect(firstRecvRow).toHaveAttribute('sender-name', 'bob')
      await expect(firstRecvRow).not.toHaveAttribute('avatar-url', /.*/)
      await expect(firstRecvRow).not.toHaveAttribute('avatar-initials', /.*/)
      const firstRecvRowClass = await firstRecvRow.evaluate(el => el.querySelector('.atoll-chat-timeline-row')?.className || '')
      expect(firstRecvRowClass).toContain('mb-1')

      // Bob's 2nd message (received by Alice): is-first-in-block="false", is-last-in-block="true", no sender-name, has avatar, spacing mb-3
      const secondRecvRow = aliceRows.nth(3)
      await expect(secondRecvRow).toHaveAttribute('is-first-in-block', 'false')
      await expect(secondRecvRow).toHaveAttribute('is-last-in-block', 'true')
      await expect(secondRecvRow).not.toHaveAttribute('sender-name', /.*/)
      // Check that it has either avatar-url or avatar-initials
      const hasAvatarUrl = await secondRecvRow.getAttribute('avatar-url')
      const hasAvatarInitials = await secondRecvRow.getAttribute('avatar-initials')
      expect(Boolean(hasAvatarUrl || hasAvatarInitials)).toBe(true)
      const secondRecvRowClass = await secondRecvRow.evaluate(el => el.querySelector('.atoll-chat-timeline-row')?.className || '')
      expect(secondRecvRowClass).toContain('mb-3')

      await aliceContext.close()
      await bobContext.close()
    })

    test('group chat bubble grouping and spacing (sent and received)', async ({ browser, loginCustomPage }) => {
      test.slow()

      // Set up Alice's context and page
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')

      // Set up Bob's context and page
      const bobContext = await browser.newContext()
      const bobPage = await bobContext.newPage()
      await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

      // Alice creates a Group chat room with Bob and Charlie
      await alicePage.locator('[data-testid$="btnCreateRoom"]').click()
      await alicePage.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
      await alicePage.locator('[data-testid$="search-result-bob"]').click()
      await alicePage.locator('create-room-modal [data-testid$="searchInput"]').fill('charlie')
      await alicePage.locator('[data-testid$="search-result-charlie"]').click()
      await alicePage.locator('[data-testid$="roomNameInput"]').fill('Group Project')
      await alicePage.locator('[data-testid$="btnCreate"]').click()

      // Wait for group room to appear and active
      await expect(alicePage.locator('chat-list chat-list-item:has-text("Group Project")')).toBeVisible({ timeout: 20000 })
      await expect(alicePage.locator('atoll-chat-view')).toBeVisible()

      // Alice sends 2 consecutive group messages
      const aliceInput = alicePage.locator('textarea[placeholder="Type a message..."]')
      await aliceInput.fill('Group Alice 1')
      await alicePage.keyboard.press('Enter')
      await alicePage.waitForTimeout(500)

      await aliceInput.fill('Group Alice 2')
      await alicePage.keyboard.press('Enter')
      await alicePage.waitForTimeout(1000)

      // Verify Alice's sent group messages
      const aliceRows = alicePage.locator('atoll-chat-timeline-row')
      await expect(aliceRows).toHaveCount(2)

      const firstSentRow = aliceRows.nth(0)
      await expect(firstSentRow).toHaveAttribute('is-first-in-block', 'true')
      await expect(firstSentRow).toHaveAttribute('is-last-in-block', 'false')
      const firstSentRowClass = await firstSentRow.evaluate(el => el.querySelector('.atoll-chat-timeline-row')?.className || '')
      expect(firstSentRowClass).toContain('mb-1')

      const secondSentRow = aliceRows.nth(1)
      await expect(secondSentRow).toHaveAttribute('is-first-in-block', 'false')
      await expect(secondSentRow).toHaveAttribute('is-last-in-block', 'true')
      const secondSentRowClass = await secondSentRow.evaluate(el => el.querySelector('.atoll-chat-timeline-row')?.className || '')
      expect(secondSentRowClass).toContain('mb-3')

      // Bob clicks on the Group Project room in his chat list
      const getGroupChatInBobList = bobPage.locator('chat-list-item').filter({ hasText: /Group Project/i })
      await expect(getGroupChatInBobList).toBeVisible({ timeout: 30000 })
      await getGroupChatInBobList.click()
      await expect(bobPage.locator('atoll-chat-view')).toBeVisible()

      // Bob sends 2 consecutive group messages
      const bobInput = bobPage.locator('textarea[placeholder="Type a message..."]')
      await bobInput.fill('Group Bob 1')
      await bobPage.keyboard.press('Enter')
      await bobPage.waitForTimeout(500)

      await bobInput.fill('Group Bob 2')
      await bobPage.keyboard.press('Enter')
      await bobPage.waitForTimeout(1000)

      // Verify Alice's received Bob's group messages
      await expect(aliceRows).toHaveCount(4)

      const firstRecvRow = aliceRows.nth(2)
      await expect(firstRecvRow).toHaveAttribute('is-first-in-block', 'true')
      await expect(firstRecvRow).toHaveAttribute('is-last-in-block', 'false')
      await expect(firstRecvRow).toHaveAttribute('sender-name', 'bob')
      await expect(firstRecvRow).not.toHaveAttribute('avatar-url', /.*/)
      await expect(firstRecvRow).not.toHaveAttribute('avatar-initials', /.*/)
      const firstRecvRowClass = await firstRecvRow.evaluate(el => el.querySelector('.atoll-chat-timeline-row')?.className || '')
      expect(firstRecvRowClass).toContain('mb-1')

      const secondRecvRow = aliceRows.nth(3)
      await expect(secondRecvRow).toHaveAttribute('is-first-in-block', 'false')
      await expect(secondRecvRow).toHaveAttribute('is-last-in-block', 'true')
      await expect(secondRecvRow).not.toHaveAttribute('sender-name', /.*/)
      const hasAvatarUrl = await secondRecvRow.getAttribute('avatar-url')
      const hasAvatarInitials = await secondRecvRow.getAttribute('avatar-initials')
      expect(Boolean(hasAvatarUrl || hasAvatarInitials)).toBe(true)
      const secondRecvRowClass = await secondRecvRow.evaluate(el => el.querySelector('.atoll-chat-timeline-row')?.className || '')
      expect(secondRecvRowClass).toContain('mb-3')

      await aliceContext.close()
      await bobContext.close()
    })
  })
})
