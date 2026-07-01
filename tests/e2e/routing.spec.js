import { test, expect } from './fixtures/base-test.js'

test.describe('Routing Plugin - Authenticated', () => {
  test.beforeEach(async ({ page, loginCustomPage }) => {
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
    await expect(page).toHaveURL(/\/\?view=chats$/)
  })

  test('Lateral Navigation: Root to Root should use replaceState', async ({ page }) => {
    const initialHistoryLength = await page.evaluate(() => window.history.length)

    await page.click('button[title="Music"]')
    await expect(page).toHaveURL(/\/\?view=music$/)

    const historyLengthAfterMusic = await page.evaluate(() => window.history.length)
    expect(historyLengthAfterMusic).toBe(initialHistoryLength)

    await page.click('button[title="Chats"]')
    await expect(page).toHaveURL(/\/\?view=chats$/)
    expect(await page.evaluate(() => window.history.length)).toBe(initialHistoryLength)
  })

  test('Drill-down: Root to Deep should use pushState', async ({ page }) => {
    const initialHistoryLength = await page.evaluate(() => window.history.length)

    // Select a chat
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await expect(page.locator('.search-result-item')).toBeVisible()
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')

    await expect(page).toHaveURL(/view=chats&id=/)
    const historyLengthAfterChatSelect = await page.evaluate(() => window.history.length)

    expect(historyLengthAfterChatSelect).toBe(initialHistoryLength + 1)
  })

  test('Lateral Navigation: Item Switch should use replaceState', async ({ page }) => {
    // 1. First drill down
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await expect(page.locator('.search-result-item')).toBeVisible()
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')
    await expect(page).toHaveURL(/view=chats&id=/)
    const historyLengthAfterFirst = await page.evaluate(() => window.history.length)

    // 2. Switch to another chat (Item switch)
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'charlie')
    await expect(page.locator('.search-result-item')).toBeVisible()
    await page.click('.search-result-item:has-text("charlie")')
    await page.click('button:has-text("Create Room")')
    await expect(page).toHaveURL(/view=chats&id=/)

    const historyLengthAfterSecond = await page.evaluate(() => window.history.length)
    expect(historyLengthAfterSecond).toBe(historyLengthAfterFirst)
  })

  test('Major Context Switch: Deep to Root should use pushState', async ({ page }) => {
    // 1. Go deep
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await expect(page.locator('.search-result-item')).toBeVisible()
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')
    await expect(page).toHaveURL(/view=chats&id=/)
    const historyLengthDeep = await page.evaluate(() => window.history.length)

    // 2. Click sidebar (Major switch)
    await page.click('button[title="Pictures"]')
    await expect(page).toHaveURL(/\/\?view=pictures$/)

    const historyLengthAfterSidebar = await page.evaluate(() => window.history.length)
    expect(historyLengthAfterSidebar).toBe(historyLengthDeep + 1)

    // 3. Back should return to deep view
    await page.goBack()
    await expect(page).toHaveURL(/view=chats&id=/)
  })

  test('Back Navigation: Should return to previous logical state', async ({ page }) => {
    // Root -> Deep
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await expect(page.locator('.search-result-item')).toBeVisible()
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')
    await expect(page).toHaveURL(/view=chats&id=/)

    await page.goBack()
    await expect(page).toHaveURL(/\/\?view=chats$/)
  })
})

test.describe('Routing Plugin - Deep Linking', () => {
  test('Deep Linking: Should restore state after auth and vault unlock', async ({ page }) => {
    // 1. Start with a deep link
    await page.goto('/?view=music')

    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    // 2. Perform Login
    const usernameInput = page.locator('input[placeholder*="username"]')
    await expect(usernameInput).toBeVisible({ timeout: 15000 })
    await usernameInput.fill('alice')
    await page.fill('input[placeholder*="Password"]', 'Password123!')
    await page.click('button:has-text("Login")')

    // 3. Perform Vault Unlock
    const vaultInput = page.locator('vault-unlock input[placeholder*="Password"]')
    await expect(vaultInput).toBeVisible({ timeout: 15000 })
    await vaultInput.fill('123456')
    await page.click('vault-unlock button:has-text("Unlock with Password")')

    // 4. Verify Restoration
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })
    await expect(page).toHaveURL(/view=music/, { timeout: 10000 })
  })
})
