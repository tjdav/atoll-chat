import { test, expect } from './fixtures/base-test.js'

test.describe('List Search', () => {
  test('should filter chats by room name and participants', async ({ page, loginCustomPage }) => {
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')

    // 1. Create a group chat to have searchable metadata
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')

    // Wait for search result and click it
    const bobResult = page.locator('.search-result-item:has-text("bob")')
    await bobResult.waitFor({ state: 'visible' })
    await bobResult.click()

    // Select another user to make it a group (to show room name input)
    await page.fill('input[placeholder="Search by username..."]', 'charlie')
    const charlieResult = page.locator('.search-result-item:has-text("charlie")')
    await charlieResult.waitFor({ state: 'visible' })
    await charlieResult.click()

    await page.fill('input[placeholder="Enter group name"]', 'Project X')

    const createBtn = page.locator('button:has-text("Create Room")')
    await expect(createBtn).toBeEnabled()
    await createBtn.click()

    // Wait for chat to appear in list
    await expect(page.locator('chat-list .app-list-item:has-text("Project X")')).toBeVisible({ timeout: 10000 })

    // 2. Test searching by group name
    const searchInput = page.locator('input[placeholder="Search..."]')
    await searchInput.fill('Project')
    await page.waitForTimeout(1000)
    await expect(page.locator('chat-list .app-list-item:has-text("Project X")')).toBeVisible()

    // Search for something non-existent
    await searchInput.fill('NonexistentXYZ')
    await page.waitForTimeout(1000)
    await expect(page.locator('text=No matches found in loaded chats')).toBeVisible()
    await expect(page.locator('chat-list .app-list-item')).toHaveCount(0)

    // 3. Test searching by participant username
    await searchInput.fill('bob')
    await page.waitForTimeout(1000)
    await expect(page.locator('chat-list .app-list-item:has-text("Project X")')).toBeVisible()
  })

  test('should filter music by metadata', async ({ page, loginCustomPage }) => {
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')

    const views = ['Music', 'Pictures', 'Videos', 'Documents']
    for (const view of views) {
      await page.click(`button[title="${view}"]`)
      await expect(page.locator('input[placeholder="Search..."]')).toBeVisible()
      await page.locator('input[placeholder="Search..."]').fill('testingXYZ')
      await page.waitForTimeout(1000)
      await expect(page.locator(`text=No matches found in loaded ${view.toLowerCase()}`)).toBeVisible()
    }
  })
})
