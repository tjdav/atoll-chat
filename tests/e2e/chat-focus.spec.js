import { test, expect } from './fixtures/base-test.js'

test.describe('Chat Input Focus', () => {
  test('should retain focus after sending a message', async ({ page, loginCustomPage }) => {
    console.log('Logging in alice...')
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')

    // Find and click on Bob's chat (assuming Bob exists in seeds or alice has a chat with him)
    // If no chat exists, we might need to create one.
    // Based on private-chat.spec.js, we can create a room.

    console.log('Alice creating room with Bob...')
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')

    const textarea = page.locator('textarea[placeholder="Type a message..."]')
    await expect(textarea).toBeVisible()

    // Initial focus
    console.log('Focusing textarea...')
    await textarea.focus()
    await expect(textarea).toBeFocused()

    // Type and send
    console.log('Sending message...')
    await textarea.fill('Testing focus persistence')
    await page.keyboard.press('Enter')

    // Wait for the message to be sent (input re-enabled)
    console.log('Waiting for input to be re-enabled...')
    await expect(textarea).toBeEnabled()

    // Check focus
    console.log('Checking if textarea is still focused...')
    // We might need a small delay if requestAnimationFrame is used
    await page.waitForTimeout(100)
    await expect(textarea).toBeFocused()

    console.log('Test passed!')
  })
})
