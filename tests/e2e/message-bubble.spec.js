import { test, expect } from '@playwright/test'

test.describe('Message Bubble Markdown Rendering', () => {
  let aliceContext
  let alicePage

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(90000)
    aliceContext = await browser.newContext()
    alicePage = await aliceContext.newPage()

    alicePage.on('console', msg => console.log('ALICE CONSOLE:', msg.text()))
    alicePage.on('pageerror', err => console.log('ALICE ERROR:', err.message))

    // Login Alice
    await alicePage.goto('/')
    await alicePage.locator('#atoll-login__username-0').fill('alice')
    await alicePage.locator('#atoll-login__password-0').fill('password123')
    await alicePage.locator('#atoll-login__submitButton-0').click()
    await expect(alicePage.getByRole('button', { name: 'New Room' })).toBeVisible({ timeout: 10000 })
  })

  test.afterAll(async () => {
    await aliceContext.close()
  })

  test('Renders markdown and sanitizes HTML', async () => {
    // Alice creates a room
    await alicePage.locator('#atoll-chat-list__openNewRoomModalBtn-0').click()
    const roomNameInput = alicePage.locator('#atoll-chat-list__roomNameInput-0')
    if (!await roomNameInput.isVisible()) {
      await alicePage.evaluate(() => {
        const modal = document.querySelector('[id^="atoll-chat-list__newRoomModal"]')
        if (modal && window.imports && window.imports.bootstrap) window.imports.bootstrap.Modal.getOrCreateInstance(modal).show()
        else if (modal && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(modal).show()
      })
      await expect(roomNameInput).toBeVisible({ timeout: 5000 })
    }
    await roomNameInput.fill('Markdown Test Room')
    await alicePage.locator('#atoll-chat-list__createRoomBtn-0').click()

    // Wait for room to be created and appear in the list
    await expect(alicePage.locator('.room-item', { hasText: 'Markdown Test Room' })).toBeVisible({ timeout: 15000 })
    await alicePage.waitForTimeout(1000)

    // Select the room
    await alicePage.locator('.room-item', { hasText: 'Markdown Test Room' }).click()

    // Alice sends a markdown message
    const msgInput = alicePage.locator('#atoll-chat-input__messageInput-0')
    await expect(msgInput).toBeVisible({ timeout: 15000 })

    // Test bold and italic markdown
    await msgInput.fill('**Bold Text** and *Italic Text*')
    await alicePage.locator('#atoll-chat-input__sendBtn-0').click()

    // Verify it rendered as HTML
    const boldElement = alicePage.locator('atoll-message-bubble strong', { hasText: 'Bold Text' }).first()
    await expect(boldElement).toBeVisible({ timeout: 15000 })

    const italicElement = alicePage.locator('atoll-message-bubble em', { hasText: 'Italic Text' }).first()
    await expect(italicElement).toBeVisible({ timeout: 15000 })

    // Test sanitization with a malicious script tag
    await msgInput.fill('<script>alert("hacked!")</script> Safe Text')
    await alicePage.locator('#atoll-chat-input__sendBtn-0').click()

    // Wait for the message to appear
    const safeTextElement = alicePage.locator('atoll-message-bubble', { hasText: 'Safe Text' }).first()
    await expect(safeTextElement).toBeVisible({ timeout: 15000 })

    // The script tag should not be in the DOM
    const scriptTagsCount = await alicePage.locator('atoll-message-bubble script').count()
    expect(scriptTagsCount).toBe(0)
  })
})
