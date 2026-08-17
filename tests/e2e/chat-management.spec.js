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

      await expect(alicePage.locator('atoll-chat-view')).toBeVisible()
      await expect(alicePage.locator('atoll-chat-view header h6')).toContainText('bob')

      const aliceMessageText = 'Hello Bob ' + Date.now()
      await alicePage.fill('textarea[placeholder="Type a message..."]', aliceMessageText)
      await expect(alicePage.locator('[data-testid$="__sendButton"]')).toBeEnabled()
      await alicePage.click('[data-testid$="__sendButton"]')

      const aliceMessageRow = alicePage.locator('atoll-chat-timeline-row').filter({ hasText: aliceMessageText })
      await expect(aliceMessageRow).toBeVisible()

      const aliceStatusContainer = alicePage.locator('atoll-chat-view .atoll-chat-message-status-container')
      await expect(aliceStatusContainer).toBeVisible({ timeout: 20000 })
      await expect(aliceStatusContainer.locator('[data-testid$="status-text"]')).toHaveText('Sent')

      const bobChatListAlice = bobPage.locator('chat-list chat-list-item').filter({ hasText: 'alice' }).first()
      await expect(bobChatListAlice).toBeVisible({ timeout: 30000 })
      await bobChatListAlice.locator('atoll-list-item').click()

      const bobReceivedRow = bobPage.locator('atoll-chat-timeline-row').filter({ hasText: aliceMessageText })
      await expect(bobReceivedRow).toBeVisible({ timeout: 10000 })

      const bobReplyText = 'Hello Alice ' + Date.now()
      await bobPage.fill('textarea[placeholder="Type a message..."]', bobReplyText)
      await bobPage.click('[data-testid$="__sendButton"]')

      await expect(bobPage.locator('atoll-chat-timeline-row').filter({ hasText: bobReplyText })).toBeVisible()
      await expect(alicePage.locator('atoll-chat-timeline-row').filter({ hasText: bobReplyText })).toBeVisible({ timeout: 20000 })

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

      const aliceChatListBob = alicePage.locator('chat-list chat-list-item').filter({ hasText: 'bob' }).first()
      await expect(aliceChatListBob.locator('span.atoll-list-item-description').first()).toHaveText('You: ' + aliceMsg)

      const bobChatListAlice = bobPage.locator('chat-list chat-list-item').filter({ hasText: 'alice' }).first()
      await expect(bobChatListAlice).toBeVisible({ timeout: 15000 })
      const bobPreviewText = bobChatListAlice.locator('span.atoll-list-item-description').first()
      await expect(bobPreviewText).toHaveText(aliceMsg)
      await expect(bobChatListAlice.locator('atoll-badge')).toBeVisible()

      await bobChatListAlice.locator('atoll-list-item').click()
      await expect(bobPreviewText).not.toHaveClass(/fw-bold/)

      await alicePage.setInputFiles('[data-testid$="__fileInput"]', {
        name: 'test.png',
        mimeType: 'image/png',
        buffer: Buffer.from('fake-image-content')
      })
      await alicePage.fill('textarea[placeholder="Type a message..."]', 'Cool image')
      await alicePage.click('[data-testid$="__sendButton"]')
      await expect(aliceChatListBob.locator('span.atoll-list-item-description').first()).toContainText('You: Sent a photo.')
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
      await expect(alicePage.locator('atoll-chat-view')).toBeVisible()

      const room_id = await alicePage.evaluate(() => window.$state.activeSelectionId)
      const bobChatListAlice = bobPage.locator('chat-list chat-list-item').filter({ hasText: 'alice' })
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

    test('should successfully delete a chat from the Room Settings sidebar', async ({ browser, loginCustomPage }) => {
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      const bobContext = await browser.newContext()
      const bobPage = await bobContext.newPage()

      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
      await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

      // Alice creates a private chat with Bob
      await alicePage.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await alicePage.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
      await alicePage.locator('[data-testid$="search-result-bob"]').click()
      await alicePage.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

      await expect(alicePage.locator('atoll-chat-view')).toBeVisible()

      // Bob's chat list item should be visible for Alice
      const bobListItem = alicePage.locator('chat-list chat-list-item').filter({ hasText: 'bob' }).first()
      await expect(bobListItem).toBeVisible({ timeout: 15000 })

      // Set up dialog handler to confirm the deletion
      alicePage.once('dialog', dialog => {
        expect(dialog.message()).toContain('Are you sure you want to delete this chat?')
        dialog.accept()
      })

      // Open Room Settings sidebar
      await alicePage.locator('[ref$="btnDetails"] button').click()
      await expect(alicePage.locator('[data-testid$="roomDetailsOffcanvas"]')).toBeVisible()

      // Wait for room details to load completely (room name matches "bob")
      await expect(alicePage.locator('[data-testid$="roomDetailsOffcanvas"] [ref$="roomNameText"]')).toHaveText('bob', { timeout: 15000 })

      // Expand Privacy & support accordion
      await alicePage.locator('[data-testid$="accordion-privacy-btn"]').click()

      // Scroll the container to the bottom to make Delete chat fully visible
      await alicePage.locator('room-details-sidebar .offcanvas-body .overflow-y-auto').evaluate(el => el.scrollTop = el.scrollHeight)

      // Click Delete chat button inside the sidebar (Privacy & support is expanded by default)
      const btnDelete = alicePage.locator('[data-testid$="btnDelete"]')
      await btnDelete.click()

      // Assert that the item is successfully removed from Alice's sidebar list
      await expect(bobListItem).not.toBeVisible({ timeout: 15000 })

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
      /* Logout first since beforeEach logs us in */
      await page.locator('[data-testid$="profileBtn"]').click()
      await page.locator('[data-testid$="btnLogout"]').click()
      await expect(page.locator('[data-testid$="username"]')).toBeVisible()

      await page.goto('/?view=music')
      await page.waitForFunction(() => {
        return window.__coralite__ && window.__coralite__.lifecycle !== undefined
      })
      await page.evaluate(() => {
        return window.__coralite__.lifecycle.hydrated
      })

      await expect(page.locator('[data-testid$="username"]')).toBeVisible({ timeout: 15000 })

      /* Login Flow */
      await page.locator('auth-login input[data-testid$="username"]').fill('alice')
      await page.locator('auth-login input[data-testid$="password"]').fill('Password123!')
      await page.locator('auth-login [data-testid$="loginSubmit"]').click()

      const vaultUnlockPasswordInput = page.locator('vault-unlock input[data-testid$="password"]')
      if (await vaultUnlockPasswordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await vaultUnlockPasswordInput.fill('VaultPassword123!')
        await page.click('vault-unlock button:has-text("Unlock with Password")')
      }
      await expect(page).toHaveURL(/view=music/, { timeout: 20000 })
      await expect(page.locator('music-list')).toBeVisible({ timeout: 15000 })
    })

    test('Timeline Navigation Starts at Last Message Sent', async ({ page }) => {
      await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
      await expect(page.locator('atoll-chat-view')).toBeVisible()

      const input = page.locator('textarea[placeholder="Type a message..."]')
      for (let i = 0; i < 30; i++) {
        await input.fill(`Persistence message ${i}`)
        await input.press('Enter')
        await page.waitForTimeout(50)
      }

      // Wait for all messages to be rendered
      await expect(page.locator('atoll-chat-timeline-row').last()).toContainText('Persistence message 29', { timeout: 20000 })

      // Wait for all message sends/sends-in-flight to complete
      await expect(page.locator('atoll-chat-timeline .atoll-chat-message-status-container [data-testid$="status-text"]')).toHaveText('Sent', { timeout: 20000 })

      const timeline = page.locator('atoll-chat-timeline .overflow-auto')

      // Scroll to TOP
      await timeline.evaluate(el => el.scrollTop = 0)
      // Verify it is scrolled up
      await expect.poll(async () => await timeline.evaluate(el => el.scrollTop)).toBeLessThan(100)

      await page.waitForTimeout(1000)
      await page.click('button[title="Music"]')
      await expect(page).toHaveURL(/\/\?view=music$/)

      await page.click('button[title="Chats"]')
      // Verify that upon returning to chat, timeline starts at the bottom at the last message sent
      await expect(page.locator('atoll-chat-timeline-row').last()).toBeInViewport({ timeout: 10000 })
      await expect(page.locator('atoll-chat-timeline-row').last()).toContainText('Persistence message 29')
    })
  })
})
