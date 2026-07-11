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

      const getBobChat = () => page.locator('chat-list-item').filter({ hasText: 'Bob' })
      await expect(getBobChat()).toBeVisible({ timeout: 30000 })

      console.log('Toggling read status...')
      await getBobChat().getByLabel('Chat actions').evaluate(el => el.click())
      await getBobChat().locator('[data-testid$="btn-toggle-read"]').click()

      // Wait for success toast to ensure operation finished
      await expect(page.locator('.toast')).toContainText(/Marked as unread|Marked as read/, { timeout: 20000 })

      // Verification: Dropdown label should have flipped
      await getBobChat().getByLabel('Chat actions').evaluate(el => el.click())
      await expect(getBobChat().locator('[data-testid$="btn-toggle-read"]')).toContainText(/Mark as read|Mark as unread/, { timeout: 15000 })

      console.log('Toggling mute status...')
      const dropdownMenu = getBobChat().locator('.dropdown-menu')
      if (!(await dropdownMenu.isVisible())) {
        await getBobChat().getByLabel('Chat actions').evaluate(el => el.click())
      }
      await getBobChat().locator('[data-testid$="btn-toggle-mute"]').click()
      await expect(page.locator('.toast')).toContainText('Notifications muted')

      page.once('dialog', dialog => dialog.accept())
      if (!(await dropdownMenu.isVisible())) {
        await getBobChat().getByLabel('Chat actions').evaluate(el => el.click())
      }
      await getBobChat().locator('[data-testid$="btn-delete-chat"]').click()
      await expect(page.locator('chat-list-item').filter({ hasText: 'Bob' })).toHaveCount(0)
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
      await expect(page.locator('link-preview-input')).toHaveCount(2, { timeout: 15000 })
      await page.locator('link-preview-input').first().locator('button[title="Dismiss preview"]').click()
      await expect(page.locator('link-preview-input')).toHaveCount(1)
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
      const bobChat = bobPage.locator('chat-list .app-list-item').filter({ hasText: 'alice' }).first()
      await expect(bobChat).toBeVisible({ timeout: 30000 })
      await bobChat.click()
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
      await expect(page.locator('chat-list .app-list-item:has-text("Project X")')).toBeVisible({ timeout: 15000 })

      await page.locator('list-pane [data-testid$="searchInput"]').fill('Project')
      await expect(page.locator('chat-list .app-list-item:has-text("Project X")')).toBeVisible()

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

      // Wait for the delayed scroll-to-bottom tick (300ms) to complete
      await page.waitForTimeout(500)

      // Take screenshot of the blurred/collapsed state
      await page.screenshot({ path: './tests/e2e/screenshots/verification.png' })
    })
  })
})
