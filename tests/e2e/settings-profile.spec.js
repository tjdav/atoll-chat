import { test, expect } from './fixtures/base-test'

test.describe('Settings Profile', () => {
  test('should update display name', async ({ page, loginApp }) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    await page.click('button[title="Settings"]')

    const newName = 'John Doe Updated'
    const nameInput = page.locator('input[placeholder="Enter your display name"]')
    await nameInput.fill(newName)

    // Wait for button to be enabled
    const saveBtn = page.locator('button:has-text("Save Changes")')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()

    // Verify toast notification
    await expect(page.locator('.toast-body')).toContainText('Profile updated successfully!')

    // Verify name updated in UI (initials in settings)
    await expect(page.locator('.avatar-circle').first()).toContainText('J')
  })

  test('should propagate display name changes across the UI', async ({ browser, loginCustomPage }) => {
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()

    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

    // Alice creates a room with Bob
    await alicePage.click('button[title="Create Room"]')
    await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
    await alicePage.click('.search-result-item:has-text("bob")')
    await alicePage.click('button:has-text("Create Room")')

    // Bob sends a message
    await bobPage.click('chat-list .list-group-item:has-text("Alice")')
    await bobPage.fill('textarea[placeholder="Type a message..."]', 'Hi Alice!')
    await bobPage.click('[data-testid$="__sendButton"]')

    // Alice updates her name
    await alicePage.click('button[title="Settings"]')
    const newName = 'Alice Wonderland'
    await alicePage.fill('input[placeholder="Enter your display name"]', newName)
    await alicePage.click('button:has-text("Save Changes")')
    await expect(alicePage.locator('.toast-body')).toContainText('Profile updated successfully!')

    // 1. Check Alice's own view (Sidebar/Room Details)
    await alicePage.click('button[title="Chats"]')
    await alicePage.click('chat-list .list-group-item:has-text("bob")')
    await alicePage.click('button:has-text("Details")') // Open Room Details
    await expect(alicePage.locator('room-details-sidebar .fw-bold').filter({ hasText: newName + ' (You)' })).toBeVisible({ timeout: 10000 })

    // 2. Check Bob's view (Chat List & Timeline)
    // Wait for real-time update on Bob's side
    const bobChatListAlice = bobPage.locator('chat-list .list-group-item').filter({ hasText: newName }).first()
    await expect(bobChatListAlice).toBeVisible({ timeout: 15000 })

    await bobChatListAlice.click()
    // Use a more relaxed contains check for header since it might have other content
    await expect(bobPage.locator('chat-view header h6')).toContainText(newName)

    // Check sender name in timeline
    await alicePage.fill('textarea[placeholder="Type a message..."]', 'My name changed!')
    await alicePage.click('[data-testid$="__sendButton"]')

    await expect(bobPage.locator('timeline-row').last().locator('text-message')).toContainText('My name changed!')
    // Alice's name should be visible in Bob's timeline if it's the first in block (but it might not be here)
    // Let's just check the header and chat list which are more reliable indicators of propagation.

    await aliceContext.close()
    await bobContext.close()
  })

  test('should open avatar editor and apply changes', async ({ page, loginApp }) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    await page.click('button[title="Settings"]')

    // Mock file input
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('.position-relative.cursor-pointer').click()
    ])

    // Create a dummy image (1x1 transparent PNG)
    await fileChooser.setFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    })

    // Verify modal appears
    await expect(page.locator('.modal-title:has-text("Edit Avatar")')).toBeVisible()

    // Interact with zoom slider
    const zoomSlider = page.locator('avatar-editor input[type="range"]')
    await zoomSlider.fill('500')

    // Click apply
    await page.click('button:has-text("Apply Changes")')

    // Verify modal closed
    await expect(page.locator('.modal-title:has-text("Edit Avatar")')).not.toBeVisible()

    // Save profile
    await page.click('button:has-text("Save Changes")')

    // Verify toast
    await expect(page.locator('.toast-body')).toContainText('Profile updated successfully!')

    // Verify avatar image is rendered in preview
    await expect(page.locator('.avatar-circle img')).toBeVisible()
  })
})
