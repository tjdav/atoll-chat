import { test, expect } from './fixtures/base-test.js'

test('Verify Avatar and Chat List UI', async ({ loginCustomPage, page }) => {
  await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
  
  // Create a room to see the avatar
  await page.click('button[title="Create Room"]')
  await page.fill('input[placeholder="Search by username..."]', 'bob')
  await page.click('.search-result-item:has-text("bob")')
  await page.click('button:has-text("Create Room")')
  
  await expect(page.locator('chat-view header h6')).toContainText('bob')
  
  // Wait for the chat list to update
  const bobItem = page.locator('chat-list .app-list-item:has-text("bob")')
  await expect(bobItem).toBeVisible()
  
  // Take a screenshot of the chat list
  await bobItem.screenshot({ path: '/home/jules/verification/screenshots/avatar_check.png' })
  
  // Take a full page screenshot
  await page.screenshot({ path: '/home/jules/verification/screenshots/full_ui.png' })
})
