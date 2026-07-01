import { test, expect } from './fixtures/base-test.js'

test.describe('Private Chat', () => {
  // Destructure our new `loginCustomPage` fixture here
  test('should allow Alice and Bob to chat privately', async ({ browser, loginCustomPage }) => {

    // 1. Setup Alice's context and page
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()

    // 2. Setup Bob's context and page
    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()

    console.log('Logging in Alice...')
    // --- Alice Login & Unlock ---
    await loginCustomPage(alicePage, 'alice', 'Password123!', '123456')

    console.log('Logging in Bob...')
    // --- Bob Login & Unlock ---
    await loginCustomPage(bobPage, 'bob', 'Password123!', '123456')

    console.log('Alice creating room with Bob...')
    // --- Alice creates chat with Bob ---
    await alicePage.click('button[title="Create Room"]')
    await expect(alicePage.locator('.modal-title:has-text("Create New Room")')).toBeVisible()

    await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
    // Wait for search result and click it
    await alicePage.click('.search-result-item:has-text("bob")')

    // Create Room (it should be a DM since only Bob is selected)
    await alicePage.click('button:has-text("Create Room")')

    // Wait for chat to open for Alice
    await expect(alicePage.locator('chat-view')).toBeVisible()
    // Use specific locator to avoid multi-element collision
    await expect(alicePage.locator('chat-view header h6')).toContainText('bob')

    console.log('Alice sending message...')
    // --- Alice sends message ---
    const aliceMessageText = 'Hello Bob ' + Date.now()
    await alicePage.fill('textarea[placeholder="Type a message..."]', aliceMessageText)
    // Wait for button to be enabled (some components might have a brief loading/disabled state)
    await expect(alicePage.locator('[data-testid$="__sendButton"]')).toBeEnabled()
    await alicePage.click('[data-testid$="__sendButton"]')

    // Verify Alice sees her message (Optimistic UI)
    const aliceMessageRow = alicePage.locator('timeline-row').filter({ hasText: aliceMessageText })
    await expect(aliceMessageRow).toBeVisible()

    // Check for optimistic state
    const isOptimisticVisible = await aliceMessageRow.locator('.placeholder-glow').isVisible()
    console.log('Alice message optimistic UI visible:', isOptimisticVisible)

    // Wait for worker to finish (Sent status)
    const aliceStatusContainer = alicePage.locator('chat-view .message-status-container')
    await expect(aliceStatusContainer).toBeVisible({ timeout: 20000 })
    await expect(aliceStatusContainer.locator('span')).toHaveText('Sent')
    await expect(aliceMessageRow.locator('.placeholder-glow')).not.toBeVisible()

    // Verify no duplicates for Alice
    await expect(aliceMessageRow).toHaveCount(1)
    await expect(aliceMessageRow.locator('text-message')).toHaveCount(1)

    // Verify IndexedDB state (One-time check to prove the pipeline)
    const localUuid = await aliceMessageRow.getAttribute('data-local-uuid')
    const dbState = await alicePage.evaluate(async (uuid) => {
      let nativeDB
      if (window.AtollChatDB) {
        nativeDB = typeof window.AtollChatDB.backendDB === 'function'
          ? window.AtollChatDB.backendDB()
          : window.AtollChatDB
      } else {
        nativeDB = await new Promise((resolve, reject) => {
          const request = indexedDB.open('AtollChatDB')
          request.onsuccess = (event) => resolve(event.target.result)
          request.onerror = (event) => reject(event.target.error)
        })
        window.AtollChatDB = nativeDB
      }
      return await new Promise((resolve, reject) => {
        const transaction = nativeDB.transaction('local_messages', 'readonly')
        const store = transaction.objectStore('local_messages')
        const request = store.get(uuid)
        request.onsuccess = (event) => resolve(event.target.result)
        request.onerror = (event) => reject(event.target.error)
      })
    }, localUuid)

    expect(dbState).toBeDefined()
    expect(dbState.status).toBe('sent')
    expect(dbState.id).not.toBeNull()

    console.log('Bob waiting for Alice\'s chat and message...')
    // --- Bob receives and replies ---
    // Bob should see the new chat in his list
    // Use data-testid if possible, or search for the room name "alice"
    const bobChatListAlice = bobPage.locator('chat-list .list-group-item').filter({ hasText: 'alice' }).first()
    await expect(bobChatListAlice).toBeVisible({ timeout: 30000 })
    await bobChatListAlice.click()

    // Verify Bob sees Alice's message
    const bobReceivedRow = bobPage.locator('timeline-row').filter({ hasText: aliceMessageText })
    await expect(bobReceivedRow).toBeVisible({ timeout: 10000 })
    await expect(bobReceivedRow).toHaveCount(1)
    await expect(bobReceivedRow.locator('text-message')).toHaveCount(1)

    // Wait for Bob's client to stabilize (avoid missing optimistic UI)
    await bobPage.waitForTimeout(500)

    console.log('Bob replying to Alice...')
    // Bob replies
    const bobReplyText = 'Hello Alice ' + Date.now()
    await bobPage.fill('textarea[placeholder="Type a message..."]', bobReplyText)
    await bobPage.click('[data-testid$="__sendButton"]')

    // Verify Bob sees his message
    const bobMessageRow = bobPage.locator('timeline-row').filter({ hasText: bobReplyText })
    await expect(bobMessageRow).toBeVisible()

    // Check for optimistic state (don't fail if it's too fast, just log)
    const isBobOptimisticVisible = await bobMessageRow.locator('.placeholder-glow').isVisible()
    console.log('Bob reply optimistic UI visible:', isBobOptimisticVisible)

    // Wait for worker to finish (Sent status)
    const bobStatusContainer = bobPage.locator('chat-view .message-status-container')
    await expect(bobStatusContainer).toBeVisible({ timeout: 20000 })
    await expect(bobStatusContainer.locator('span')).toHaveText('Sent')
    await expect(bobMessageRow.locator('.placeholder-glow')).not.toBeVisible()

    // Verify no duplicates for Bob
    await expect(bobMessageRow).toHaveCount(1)
    await expect(bobMessageRow.locator('text-message')).toHaveCount(1)

    console.log('Alice waiting for Bob\'s reply...')
    // --- Alice receives reply ---
    const aliceReceivedRow = alicePage.locator('timeline-row').filter({ hasText: bobReplyText })
    await expect(aliceReceivedRow).toBeVisible({ timeout: 20000 })
    await expect(aliceReceivedRow).toHaveCount(1)
    await expect(aliceReceivedRow.locator('text-message')).toHaveCount(1)

    console.log('Test completed successfully!')

    // Cleanup
    await aliceContext.close()
    await bobContext.close()
  })
})
