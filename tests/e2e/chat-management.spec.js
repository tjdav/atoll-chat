import { test, expect } from './fixtures/base-test.js'

test.describe('Chat Management', () => {

  test.describe('Private Chat', () => {
    test('should allow Alice and Bob to chat privately', async ({ browser, loginCustomPage }) => {
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      const bobContext = await browser.newContext()
      const bobPage = await bobContext.newPage()

      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
      await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

      await alicePage.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await expect(alicePage.locator('.modal-title:has-text("Create New Room")')).toBeVisible()
      await alicePage.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
      await alicePage.locator('[data-testid$="search-result-bob"]').click()
      await alicePage.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

      await expect(alicePage.locator('chat-view')).toBeVisible()
      await expect(alicePage.locator('chat-view header h6')).toContainText('bob')

      const aliceMessageText = 'Hello Bob ' + Date.now()
      await alicePage.fill('textarea[placeholder="Type a message..."]', aliceMessageText)
      await expect(alicePage.locator('[data-testid$="__sendButton"]')).toBeEnabled()
      await alicePage.click('[data-testid$="__sendButton"]')

      const aliceMessageRow = alicePage.locator('timeline-row').filter({ hasText: aliceMessageText })
      await expect(aliceMessageRow).toBeVisible()

      const aliceStatusContainer = alicePage.locator('chat-view .message-status-container')
      await expect(aliceStatusContainer).toBeVisible({ timeout: 20000 })
      await expect(aliceStatusContainer.locator('span')).toHaveText('Sent')

      const bobChatListAlice = bobPage.locator('chat-list .app-list-item').filter({ hasText: 'alice' }).first()
      await expect(bobChatListAlice).toBeVisible({ timeout: 30000 })
      await bobChatListAlice.click()

      const bobReceivedRow = bobPage.locator('timeline-row').filter({ hasText: aliceMessageText })
      await expect(bobReceivedRow).toBeVisible({ timeout: 10000 })

      const bobReplyText = 'Hello Alice ' + Date.now()
      await bobPage.fill('textarea[placeholder="Type a message..."]', bobReplyText)
      await bobPage.click('[data-testid$="__sendButton"]')

      await expect(bobPage.locator('timeline-row').filter({ hasText: bobReplyText })).toBeVisible()
      await expect(alicePage.locator('timeline-row').filter({ hasText: bobReplyText })).toBeVisible({ timeout: 20000 })

      await aliceContext.close()
      await bobContext.close()
    })
  })

  test.describe('Chat List & Indicators', () => {
    test('should show latest message preview and handle unread state correctly', async ({ browser, loginCustomPage }) => {
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      const bobContext = await browser.newContext()
      const bobPage = await bobContext.newPage()

      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
      await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

      await alicePage.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await alicePage.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
      await alicePage.locator('[data-testid$="search-result-bob"]').click()
      await alicePage.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

      const aliceMsg = 'Hello Bob, check this unread indicator!'
      await alicePage.fill('textarea[placeholder="Type a message..."]', aliceMsg)
      await alicePage.click('[data-testid$="__sendButton"]')

      const aliceChatListBob = alicePage.locator('chat-list .app-list-item').filter({ hasText: 'bob' }).first()
      await expect(aliceChatListBob.locator('small.text-truncate').first()).toHaveText('You: ' + aliceMsg)

      const bobChatListAlice = bobPage.locator('chat-list .app-list-item').filter({ hasText: 'alice' }).first()
      await expect(bobChatListAlice).toBeVisible({ timeout: 15000 })
      const bobPreviewText = bobChatListAlice.locator('small.text-truncate').first()
      await expect(bobPreviewText).toHaveText(aliceMsg)
      await expect(bobPreviewText).toHaveClass(/fw-bold/)
      await expect(bobChatListAlice.locator('.bg-primary.rounded-circle')).toBeVisible()

      await bobChatListAlice.click()
      await expect(bobPreviewText).not.toHaveClass(/fw-bold/)

      await alicePage.setInputFiles('[data-testid$="__imageInput"]', {
        name: 'test.png',
        mimeType: 'image/png',
        buffer: Buffer.from('fake-image-content')
      })
      await alicePage.fill('textarea[placeholder="Type a message..."]', 'Cool image')
      await alicePage.click('[data-testid$="__sendButton"]')
      await expect(aliceChatListBob.locator('small.text-truncate').first()).toContainText('You: Sent a photo.')
      await expect(bobPreviewText).toContainText('Sent a photo.')

      await aliceContext.close()
      await bobContext.close()
    })

    test('should not duplicate chat items during rapid updates', async ({ browser, loginCustomPage }) => {
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      const bobContext = await browser.newContext()
      const bobPage = await bobContext.newPage()

      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
      await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

      await alicePage.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await alicePage.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
      await alicePage.locator('[data-testid$="search-result-bob"]').click()
      await alicePage.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
      await expect(alicePage.locator('chat-view')).toBeVisible()

      const room_id = await alicePage.evaluate(() => window.$state.activeSelectionId)
      const bobChatListAlice = bobPage.locator('chat-list .app-list-item').filter({ hasText: 'alice' })
      await expect(bobChatListAlice).toBeVisible({ timeout: 15000 })

      await bobPage.evaluate((rid) => {
        for (let i = 0; i < 10; i++) {
          window.$bus.emit('db:new_local_data', { room_id: rid })
        }
      }, room_id)

      await bobPage.waitForTimeout(1000)
      expect(await bobChatListAlice.count()).toBe(1)

      await aliceContext.close()
      await bobContext.close()
    })
  })

  test.describe('Routing and Persistence', () => {
    test.beforeEach(async ({ page, loginCustomPage }) => {
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      await expect(page).toHaveURL(/\/\?view=chats$/)
    })

    test('Lateral Navigation: Root to Root should use replaceState', async ({ page }) => {
      const initialHistoryLength = await page.evaluate(() => window.history.length)
      await page.click('button[title="Music"]')
      await expect(page).toHaveURL(/\/\?view=music$/)
      expect(await page.evaluate(() => window.history.length)).toBe(initialHistoryLength)
    })

    test('Drill-down: Root to Deep should use pushState', async ({ page }) => {
      const initialHistoryLength = await page.evaluate(() => window.history.length)
      await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
      await expect(page).toHaveURL(/view=chats&id=/)
      expect(await page.evaluate(() => window.history.length)).toBe(initialHistoryLength + 1)
    })

    test('Deep Linking Restoration', async ({ page }) => {
      // Logout first since beforeEach logs us in
      await page.click('button[title="Logout"]')
      await expect(page.locator('input[placeholder*="username"]')).toBeVisible()

      await page.goto('/?view=music')
      await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
      await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

      await expect(page.locator('input[placeholder*="username"]')).toBeVisible({ timeout: 15000 })

      await page.fill('input[placeholder*="username"]', 'alice')
      await page.fill('input[placeholder*="Password"]', 'Password123!')
      await page.click('button:has-text("Login")')
      await expect(page.locator('vault-unlock input[placeholder*="Password"]')).toBeVisible({ timeout: 15000 })
      await page.fill('vault-unlock input[placeholder*="Password"]', 'VaultPassword123!')
      await page.click('vault-unlock button:has-text("Unlock with Password")')
      await expect(page).toHaveURL(/view=music/, { timeout: 20000 })
      await expect(page.locator('music-list')).toBeVisible({ timeout: 15000 })
    })

    test('Timeline Scroll Restoration', async ({ page }) => {
      await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
      await expect(page.locator('chat-view')).toBeVisible()

      const input = page.locator('textarea[placeholder="Type a message..."]')
      for (let i = 0; i < 30; i++) {
        await input.fill(`Persistence message ${i}`)
        await input.press('Enter')
        await page.waitForTimeout(50)
      }

      // Wait for all messages to be rendered
      await expect(page.locator('timeline-row').last()).toContainText('Persistence message 29', { timeout: 20000 })

      const timeline = page.locator('message-timeline .overflow-auto')

      // Scroll to TOP
      await timeline.evaluate(el => el.scrollTop = 0)
      // Verify it is scrolled up
      await expect.poll(async () => await timeline.evaluate(el => el.scrollTop)).toBeLessThan(100)

      await page.waitForTimeout(1000)
      await page.click('button[title="Music"]')
      await expect(page).toHaveURL(/\/\?view=music$/)

      await page.click('button[title="Chats"]')
      // Wait for chat to reload and scroll to be restored
      await expect.poll(async () => {
        const data = await page.evaluate(() => {
          const state = window.Coralite && window.Coralite.globalStore && window.Coralite.globalStore.state
          return {
            scrollTop: document.querySelector('message-timeline .overflow-auto')?.scrollTop,
            scrollPositions: state ? state.scrollPositions : undefined,
            activeSelectionId: state ? state.activeSelectionId : undefined
          }
        })
        console.log('Restored scroll top check:', data.scrollTop, 'Positions:', JSON.stringify(data.scrollPositions), 'Active:', data.activeSelectionId)
        return data.scrollTop
      }, {
        timeout: 10000
      }).toBeLessThan(400)
    })
  })
})
