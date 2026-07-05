import { test, expect } from './fixtures/base-test.js'

test.describe('Chat List Latest Message and Unread Indicators', () => {
  test('should show latest message preview and handle unread state correctly', async ({ browser, loginCustomPage }) => {

    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()

    console.log('Logging in Alice and Bob...')
    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

    console.log('Alice creating room and sending text message...')
    // Alice creates room and sends message
    await alicePage.click('button[title="Create Room"]')
    await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
    await alicePage.click('.search-result-item:has-text("bob")')
    await alicePage.click('button:has-text("Create Room")')
    await expect(alicePage.locator('chat-view header h6')).toContainText('bob')

    const aliceMsg = 'Hello Bob, check this unread indicator!'
    await alicePage.fill('textarea[placeholder="Type a message..."]', aliceMsg)
    await alicePage.click('[data-testid$="__sendButton"]')
    await expect(alicePage.locator('timeline-row:has-text("' + aliceMsg + '")')).toBeVisible()

    // 1. Verify Alice sees her own message as 'read' (not bold)
    console.log('Verifying Alice sees her message as read...')
    const aliceChatListBob = alicePage.locator('chat-list .app-list-item').filter({ hasText: 'bob' }).first()
    await expect(aliceChatListBob).toBeVisible()
    const alicePreviewText = aliceChatListBob.locator('small.text-truncate').first()
    await expect(alicePreviewText).toHaveText('You: ' + aliceMsg)
    await expect(alicePreviewText).not.toHaveClass(/fw-bold/)
    await expect(aliceChatListBob.locator('.bg-primary.rounded-circle')).not.toBeVisible()

    // 2. Verify Bob sees Alice's message as 'unread' (bold + blue dot)
    console.log('Verifying Bob sees Alice\'s message as unread...')
    const bobChatListAlice = bobPage.locator('chat-list .app-list-item').filter({ hasText: 'alice' }).first()
    await expect(bobChatListAlice).toBeVisible({ timeout: 15000 })
    const bobPreviewText = bobChatListAlice.locator('small.text-truncate').first()
    await expect(bobPreviewText).toHaveText(aliceMsg)
    await expect(bobPreviewText).toHaveClass(/fw-bold/)
    await expect(bobChatListAlice.locator('.bg-primary.rounded-circle')).toBeVisible()

    // 3. Verify Bob clicks the chat and it marks as read
    console.log('Verifying Bob clicks and marks as read...')
    await bobChatListAlice.click()
    await expect(bobPage.locator('timeline-row:has-text("' + aliceMsg + '")')).toBeVisible()

    // Check list again - bolding and dot should be gone
    await expect(bobPreviewText).not.toHaveClass(/fw-bold/)
    await expect(bobChatListAlice.locator('.bg-primary.rounded-circle')).not.toBeVisible()

    // 4. Verify Media Message Preview
    console.log('Verifying Media Message Preview...')
    // Alice sends an image
    await alicePage.setInputFiles('[data-testid$="__imageInput"]', {
      name: 'test.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake-image-content')
    })
    await alicePage.fill('textarea[placeholder="Type a message..."]', 'Cool image')
    await alicePage.click('[data-testid$="__sendButton"]')

    // Wait for upload (worker status check)
    await expect(alicePage.locator('timeline-row:has-text("Cool image")')).toBeVisible()

    // Alice sees "You: Sent a photo."
    await expect(alicePreviewText).toContainText('You: Sent a photo.')

    // Bob sees "Sent a photo." as unread
    await expect(bobPreviewText).toContainText('Sent a photo.')
    await expect(bobPreviewText).toHaveClass(/fw-bold/)
    await expect(bobChatListAlice.locator('.bg-primary.rounded-circle')).toBeVisible()

    console.log('Cleanup...')
    await aliceContext.close()
    await bobContext.close()
  })
})
