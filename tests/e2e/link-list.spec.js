import { test, expect } from './fixtures/base-test.js'

test.describe('Link List', () => {
  test('should aggregate links and support jumping to chat', async ({ page, loginCustomPage }) => {
    // 1. Mock link extraction to ensure it always succeeds in test environment
    await page.route('**/api/link-extraction*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title: 'PocketBase',
          description: 'Open Source backend in 1 file',
          image: '',
          domain: 'github.com',
          url: 'https://github.com/pocketbase/pocketbase'
        })
      });
    });

    // 2. Login Alice
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')

    // 3. Create chat with Bob
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    // Wait for search result
    const bobResult = page.locator('.search-result-item').filter({ hasText: 'bob' })
    await expect(bobResult).toBeVisible()
    await bobResult.click()
    
    const btnCreate = page.locator('button:has-text("Create Room")')
    await expect(btnCreate).toBeEnabled()
    await btnCreate.click()

    await expect(page.locator('chat-view')).toBeVisible({ timeout: 10000 })

    // 4. Alice sends a link
    const url = 'https://github.com/pocketbase/pocketbase'
    await page.fill('textarea[placeholder="Type a message..."]', `${url} `)
    
    // Wait for preview to appear (mocked)
    await expect(page.locator('link-preview-input')).toBeVisible({ timeout: 10000 })

    await page.click('[data-testid$="__sendButton"]')

    // 5. Verify link in timeline
    await expect(page.locator('link-preview')).toBeVisible({ timeout: 15000 })

    // 6. Open Link List
    await page.click('button[title="Links"]')
    await expect(page.locator('link-list')).toBeVisible()

    // 7. Verify link in list
    const listItem = page.locator('.link-list .list-group-item').first()
    await expect(listItem).toBeVisible()
    await expect(listItem).toContainText('PocketBase', { ignoreCase: true })

    // 8. Click link to see details
    await listItem.click()
    await expect(page.locator('link-viewer')).toBeVisible()
    await expect(page.locator('link-viewer .card-title')).toContainText('PocketBase')

    // 9. Click Jump to Chat
    await page.click('button:has-text("Jump to Chat")')
    
    // 10. Verify we are back in chat and message is visible
    await expect(page.locator('chat-view')).toBeVisible()
    await expect(page.locator('link-preview')).toBeVisible()
  })

  test('should show empty state when no links found', async ({ page, loginCustomPage }) => {
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
    await page.click('button[title="Links"]')
    await expect(page.locator('link-list')).toContainText('No links found')
  })
})
