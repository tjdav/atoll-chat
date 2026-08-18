import { test, expect } from './fixtures/base-test.js'

test.describe('Deep Linking & Universal Links', () => {
  test('should join room and select it when loading with a deep-linked group invitation', async ({ browser, loginCustomPage }) => {
    /* Login as alice and create a room to get a valid room ID */
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    await loginCustomPage(alicePage, 'alice', 'Password123!', 'Password123!')

    /* Create the room as alice, adding charlie instead of bob */
    await alicePage.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await alicePage.locator('create-room-modal [data-testid$="searchInput"]').fill('charlie')
    await alicePage.locator('[data-testid$="search-result-charlie"]').click()
    await alicePage.locator('[data-testid$="btnCreate"]').click()

    /* Wait for room to be created and find the selected room ID from global state */
    await expect(alicePage.locator('chat-list-item')).toBeVisible({ timeout: 15000 })
    const roomId = await alicePage.evaluate(() => {
      return window.$state.activeSelectionId
    })
    expect(roomId).toBeDefined()

    /* Login as bob in a completely separate browser context */
    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'Password123!')

    /* Verify bob does not have this room yet */
    const roomItemLocator = bobPage.locator(`chat-list-item[room-id="${roomId}"]`)
    await expect(roomItemLocator).not.toBeVisible()

    /* Load the group invitation deep link as bob */
    const inviteUrl = `/?invite=${roomId}`
    await bobPage.goto(inviteUrl)

    /* Wait for hydration */
    await bobPage.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await bobPage.evaluate(() => window.__coralite__.lifecycle.hydrated)

    /* Since this is a fresh page load, we must unlock Bob's vault to display the app UI */
    await expect(bobPage.locator('vault-unlock')).toBeVisible({ timeout: 15000 })
    await expect(bobPage.getByRole('heading', { name: 'Welcome Back' })).toBeVisible({ timeout: 15000 })
    await bobPage.locator('[data-testid$="password"]').fill('Password123!')
    await bobPage.locator('[data-testid$="unlockSubmit"]').click()

    /* It should automatically join and select the room in the chat-list once the vault is unlocked */
    await expect(bobPage.locator(`chat-list-item[room-id="${roomId}"]`)).toBeVisible({ timeout: 15000 })
    const activeSelectionId = await bobPage.evaluate(() => {
      return window.$state.activeSelectionId
    })
    expect(activeSelectionId).toBe(roomId)

    /* Clean up the extra contexts */
    await aliceContext.close()
    await bobContext.close()
  })

  test('should redirect unauthenticated user to register and pre-fill invitation code from ?invite=', async ({ page }) => {
    await page.goto('/?invite=INV-TEST-1111')

    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    /* Should render register component */
    await expect(page.locator('auth-register')).toBeVisible({ timeout: 15000 })

    /* Invitation code input should be auto-filled and formatted */
    const inviteInput = page.locator('auth-register input[data-testid="invitationCode"]')
    await expect(inviteInput).toBeVisible()
    await expect(inviteInput).toHaveValue('INV-TEST-1111')

    /* URL query param should be sanitized from address bar */
    await expect(page).toHaveURL('/')
  })

  test('should redirect unauthenticated user to register and pre-fill invitation code from ?code=', async ({ page }) => {
    await page.goto('/?code=INV-TEST-2222')

    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    await expect(page.locator('auth-register')).toBeVisible({ timeout: 15000 })
    const inviteInput = page.locator('auth-register input[data-testid="invitationCode"]')
    await expect(inviteInput).toHaveValue('INV-TEST-2222')

    await expect(page).toHaveURL('/')
  })

  test('should redirect unauthenticated user to register and pre-fill invitation code from /invite/ path via popstate', async ({ page }) => {
    await page.goto('/')

    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    await page.evaluate(() => {
      window.history.pushState({}, '', '/invite/INV-TEST-3333')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    await expect(page.locator('auth-register')).toBeVisible({ timeout: 15000 })
    const inviteInput = page.locator('auth-register input[data-testid="invitationCode"]')
    await expect(inviteInput).toHaveValue('INV-TEST-3333')

    await expect(page).toHaveURL('/')
  })

  test('should display toast when already-authenticated user opens an invite link', async ({ page, loginCustomPage }) => {
    await loginCustomPage(page, 'alice', 'Password123!', 'Password123!')
    await expect(page.locator('chat-list')).toBeVisible({ timeout: 15000 })

    /* Trigger registration invite link in active session */
    await page.evaluate(() => {
      window.history.pushState({}, '', '/?invite=INV-TEST-4444')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    /* Toast notification should be displayed */
    const toastBody = page.locator('.toast-body')
    await expect(toastBody).toBeVisible({ timeout: 15000 })
    await expect(toastBody).toHaveText('You are already logged in to Atoll.')

    /* URL should be sanitized */
    await expect(page).toHaveURL('/')
  })
})
