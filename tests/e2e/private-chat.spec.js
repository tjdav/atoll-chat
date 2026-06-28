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
    await alicePage.fill('textarea[placeholder="Type a message..."]', 'Hello Bob')
    // Wait for button to be enabled (some components might have a brief loading/disabled state)
    await expect(alicePage.locator('button:has-text("Send")')).toBeEnabled()
    await alicePage.click('button:has-text("Send")')

    // Verify Alice sees her message
    await expect(alicePage.locator('timeline-row:has-text("Hello Bob")')).toBeVisible()

    console.log('Bob waiting for Alice\'s chat and message...')
    // --- Bob receives and replies ---
    // Bob should see the new chat in his list
    // Use data-testid if possible, or search for the room name "alice"
    const bobChatListAlice = bobPage.locator('chat-list .list-group-item').filter({ hasText: 'alice' }).first()
    await expect(bobChatListAlice).toBeVisible({ timeout: 30000 })
    await bobChatListAlice.click()

    // Verify Bob sees Alice's message
    await expect(bobPage.locator('timeline-row:has-text("Hello Bob")')).toBeVisible({ timeout: 10000 })

    console.log('Bob replying to Alice...')
    // Bob replies
    await bobPage.fill('textarea[placeholder="Type a message..."]', 'Hello Alice')
    await bobPage.click('button:has-text("Send")')

    // Verify Bob sees his message
    await expect(bobPage.locator('timeline-row:has-text("Hello Alice")')).toBeVisible()

    console.log('Alice waiting for Bob\'s reply...')
    // --- Alice receives reply ---
    await expect(alicePage.locator('timeline-row:has-text("Hello Alice")')).toBeVisible({ timeout: 20000 })

    console.log('Test completed successfully!')

    // Cleanup
    await aliceContext.close()
    await bobContext.close()
  })
})
