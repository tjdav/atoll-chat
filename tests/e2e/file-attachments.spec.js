import { test, expect } from './fixtures/base-test.js'
import path from 'path'

test.describe('File Attachments', () => {
  const testFiles = [
    { name: 'test.png', type: 'image', selector: 'media-preview img' },
    { name: 'test.mp4', type: 'video', selector: 'media-preview video' },
    { name: 'test.docx', type: 'document', selector: 'file-attachment' },
    { name: 'test.tar', type: 'archive', selector: 'file-attachment' },
    { name: 'test.txt', type: 'text', selector: 'file-attachment' }
  ]

  test('should allow Alice to send various file types to Bob and verify reception', async ({ browser, loginCustomPage }) => {
    test.setTimeout(120000)
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

    console.log('Bob waiting for Alice\'s chat...')
    const bobChatListAlice = bobPage.locator('chat-list .list-group-item').filter({ hasText: 'alice' }).first()
    await expect(bobChatListAlice).toBeVisible({ timeout: 30000 })
    await bobChatListAlice.click()

    for (const file of testFiles) {
      console.log(`Testing file: ${file.name} (${file.type})`)
      
      const filePath = path.resolve(`tests/e2e/fixtures/test-files/${file.name}`)
      await alicePage.locator('chat-input-text input[type="file"]').setInputFiles(filePath)

      // Verify attachment preview shows up
      await expect(alicePage.locator('chat-attachment-preview')).toBeVisible()
      await expect(alicePage.locator('chat-attachment-preview')).toContainText(file.name)

      const caption = `Sending ${file.name}`
      // Clear and fill caption
      await alicePage.locator('textarea[placeholder="Type a message..."]').fill(caption)

      console.log(`Alice sending ${file.name}...`)
      await alicePage.click('button:has-text("Send")')

      // Alice's Worker Confirmation: Wait for global sent status to appear
      const statusContainer = alicePage.locator('chat-view .message-status-container')
      await expect(statusContainer).toBeVisible({ timeout: 20000 })
      await expect(statusContainer.locator('span')).toHaveText('Sent', { timeout: 60000 })

      // Bob's Inbound UI: Verify the message bubble and caption
      console.log(`Bob waiting for ${file.name}...`)
      const bobMessageRow = bobPage.locator('timeline-row').filter({ hasText: caption }).last()
      await expect(bobMessageRow).toBeVisible({ timeout: 60000 })

      // Verify component rendering
      console.log(`Verifying Bob rendered ${file.name} correctly...`)
      await expect(bobMessageRow.locator(file.selector)).toBeVisible({ timeout: 30000 })

      if (file.selector === 'file-attachment') {
        await expect(bobMessageRow.locator('file-attachment')).toContainText(file.name)
      }
    }

    console.log('All file types tested successfully!')

    // Cleanup
    await aliceContext.close()
    await bobContext.close()
  })
})
