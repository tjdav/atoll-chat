import { test, expect } from './fixtures/base-test.js'

test.describe('Deep Linking & Universal Links', () => {
  test('should join room and select it when loading with a deep-linked group invitation', async ({ browser, loginCustomPage }) => {
    /* Login as alice and create a room to get a valid room ID */
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')

    /* Create the room as alice, adding charlie instead of bob */
    await alicePage.locator('[data-testid$="btnCreateRoom"]').click()
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
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

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
    await expect(bobPage.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible({ timeout: 15000 })
    await bobPage.locator('[data-testid$="password"]').fill('VaultPassword123!')
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
})
