import { test, expect } from './fixtures/base-test.js'
import path from 'path'

test.describe('Media Messaging', () => {
  test('should allow Alice to send an image with caption to Bob and verify decryption', async ({ browser, loginCustomPage }) => {
    // 1. Setup Alice's context and page
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()

    // 2. Setup Bob's context and page
    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()

    console.log('Logging in Alice and Bob...')
    await Promise.all([
      loginCustomPage(alicePage, 'alice', 'Password123!', '123456'),
      loginCustomPage(bobPage, 'bob', 'Password123!', '123456')
    ])

    console.log('Alice creating room with Bob...')
    await alicePage.click('button[title="Create Room"]')
    await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
    await alicePage.click('.search-result-item:has-text("bob")')
    await alicePage.click('button:has-text("Create Room")')

    await expect(alicePage.locator('chat-view header h6')).toContainText('bob')

    console.log('Alice selecting image and adding caption...')
    const filePath = path.resolve('tests/e2e/fixtures/test-files/test.png')
    await alicePage.locator('chat-input-text input[type="file"]').setInputFiles(filePath)

    // Verify attachment preview shows up
    await expect(alicePage.locator('chat-attachment-preview')).toBeVisible()
    await expect(alicePage.locator('chat-attachment-preview')).toContainText('test.png')

    const caption = 'Check out this cool image!'
    await alicePage.fill('textarea[placeholder="Type a message..."]', caption)

    console.log('Alice sending image...')
    await alicePage.click('button:has-text("Send")')

    // Alice's Optimistic UI: Verify placeholder-glow is visible
    const aliceMessageRow = alicePage.locator('timeline-row').last()
    // It might be too fast, so we check if it is either visible or already replaced by the content
    const isOptimisticVisible = await aliceMessageRow.locator('.placeholder-glow').isVisible()
    console.log('Optimistic UI visible:', isOptimisticVisible)

    // Alice's Worker Confirmation: Wait for global sent status to appear
    console.log('Waiting for Alice\'s worker to finish encryption and upload...')
    const statusContainer = alicePage.locator('chat-view .message-status-container')
    await expect(statusContainer).toBeVisible({ timeout: 20000 })
    await expect(statusContainer.locator('span')).toHaveText('Sent')
    await expect(aliceMessageRow.locator('.placeholder-glow')).not.toBeVisible()

    // Verify no duplicates for Alice
    await expect(alicePage.locator('timeline-row').filter({ hasText: caption })).toHaveCount(1)
    await expect(aliceMessageRow.locator('media-preview')).toHaveCount(1)
    await expect(aliceMessageRow.locator('media-preview img')).toHaveCount(1)
    await expect(aliceMessageRow.locator('text-message')).toHaveCount(1)

    console.log('Bob waiting for Alice\'s chat and message...')
    const bobChatListAlice = bobPage.locator('chat-list .list-group-item').filter({ hasText: 'alice' }).first()
    await expect(bobChatListAlice).toBeVisible({ timeout: 30000 })
    await bobChatListAlice.click()

    // Bob's Inbound UI: Verify the message bubble and caption
    const bobMessageRow = bobPage.locator('timeline-row').filter({ hasText: caption })
    await expect(bobMessageRow).toBeVisible({ timeout: 10000 })

    // Verify no duplicates for Bob
    await expect(bobMessageRow).toHaveCount(1)
    await expect(bobMessageRow.locator('media-preview')).toHaveCount(1)
    await expect(bobMessageRow.locator('media-preview img')).toHaveCount(1)
    await expect(bobMessageRow.locator('text-message')).toHaveCount(1)

    // Bob's Decryption: Verify image is decrypted and rendered as a blob URL
    console.log('Verifying Bob decrypted the image...')
    const bobImage = bobMessageRow.locator('media-preview img').first()
    await expect(bobImage).toBeVisible({ timeout: 20000 })

    const imageSrc = await bobImage.getAttribute('src')
    expect(imageSrc).toMatch(/^blob:/)

    console.log('Test completed successfully!')

    // Cleanup
    await aliceContext.close()
    await bobContext.close()
  })
})
