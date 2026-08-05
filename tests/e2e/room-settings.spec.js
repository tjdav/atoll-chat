import { test, expect } from './fixtures/base-test.js'

test.describe('ADSM Room Settings & Details Offcanvas Sidebar', () => {
  test.beforeEach(async ({ page, loginCustomPage }) => {
    // 1. Log in Alice and set up a chat room with Bob
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
    await expect(page).toHaveURL(/\/\?view=chats$/)

    // Create room with Bob
    await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    await expect(page.locator('chat-view')).toBeVisible()
    await expect(page.locator('chat-view header h6')).toContainText('bob')
  })

  test('should open and close the native Bootstrap Offcanvas drawer smoothly', async ({ page }) => {
    const offcanvas = page.locator('[data-testid$="roomDetailsOffcanvas"]')
    await expect(offcanvas).not.toBeVisible()

    // Open Offcanvas (Using suffix selector on compiled refs and clicking inner button)
    await page.locator('[ref$="btnDetails"] button').click()
    await expect(offcanvas).toBeVisible()

    // Hero section checks
    await expect(offcanvas.locator('atoll-profile[ref$="roomAvatar"]')).toBeVisible()
    await expect(offcanvas.locator('[ref$="roomNameText"]')).toContainText('bob')
    await expect(offcanvas.locator('.e2e-badge')).toContainText('End-to-End Encrypted')

    // Close Offcanvas via top-right close button
    await page.locator('[data-testid$="sidebar-close-btn"]').click()
    await expect(offcanvas).not.toBeVisible()
  })

  test('should support collapsible accordion groups', async ({ page }) => {
    // Open offcanvas
    await page.locator('[ref$="btnDetails"] button').click()

    const customiseCollapse = page.locator('#collapseCustomise')
    const privacyCollapse = page.locator('#collapsePrivacy')
    const membersCollapse = page.locator('#collapseMembers')

    // Verify initially collapsed
    await expect(customiseCollapse).not.toBeVisible()
    await expect(privacyCollapse).not.toBeVisible()
    await expect(membersCollapse).not.toBeVisible()

    // Expand Customise Chat
    await page.locator('[data-testid$="accordion-customise-btn"]').click()
    await expect(customiseCollapse).toBeVisible()

    // Expand Privacy & Support
    await page.locator('[data-testid$="accordion-privacy-btn"]').click()
    await expect(privacyCollapse).toBeVisible()

    // Expand Members
    await page.locator('[data-testid$="accordion-members-btn"]').click()
    await expect(membersCollapse).toBeVisible()
    await expect(page.locator('[data-testid$="memberListContainer"]')).toBeVisible()
  })

  test('should launch theme selection popup and apply custom gradients', async ({ page }) => {
    await page.locator('[ref$="btnDetails"] button').click()
    await page.locator('[data-testid$="accordion-customise-btn"]').click()

    // Open theme selector modal
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    const themeModal = page.locator('[data-testid$="themeSelectorModal"]')
    await expect(themeModal.locator('.modal')).toBeVisible()

    // Highlight Ocean theme
    await page.locator('[data-testid$="theme-ocean-item"]').click()
    await expect(themeModal.locator('[data-testid$="checkOcean"]')).not.toHaveClass(/d-none/)

    // Save/Select Theme (Target inner button inside atoll-button wrapper)
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal.locator('.modal')).not.toBeVisible()

    // Verify main chat view container has data-theme="ocean" applied
    const chatContainer = page.locator('[data-testid$="chat-view-container"]')
    await expect(chatContainer).toHaveAttribute('data-theme', 'ocean')
  })

  test('should edit participant nicknames via nickname management inline form', async ({ page }) => {
    await page.locator('[ref$="btnDetails"] button').click()
    await page.locator('[data-testid$="accordion-customise-btn"]').click()

    // Open nicknames modal
    await page.locator('[data-testid$="btnEditNicknames"]').click()
    const nicknamesModal = page.locator('[data-testid$="nicknamesModal"]')
    await expect(nicknamesModal.locator('.modal')).toBeVisible()

    // Highlight/click participant row (e.g. Bob or bob case-insensitively)
    const bobItem = nicknamesModal.locator('atoll-list-item').filter({ hasText: /bob/i })
    await expect(bobItem).toBeVisible()
    await bobItem.click()

    // Inline edit prefilled with current nickname (Use precise input[type="text"] to avoid strict check conflicts with checkbox)
    const inlineInput = nicknamesModal.locator('input[type="text"]')
    await expect(inlineInput).toBeVisible()
    await inlineInput.fill('Bobby')
    
    // Click the inline confirm button (success button with check icon)
    await nicknamesModal.locator('button.btn-success').click()

    // Save nicknames changes
    await nicknamesModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(nicknamesModal.locator('.modal')).not.toBeVisible()

    // Nickname is updated in room details text & chat view header!
    await expect(page.locator('[data-testid$="roomDetailsOffcanvas"] [ref$="roomNameText"]')).toContainText('Bobby')
    await expect(page.locator('chat-view header h6')).toContainText('Bobby')
  })

  test('should support privacy controls: read receipts and notifications mute toggle', async ({ page }) => {
    await page.locator('[ref$="btnDetails"] button').click()
    await page.locator('[data-testid$="accordion-privacy-btn"]').click()

    // 1. Mute notifications toggle
    const muteBadge = page.locator('[ref$="muteStatusBadge"]')
    await expect(muteBadge).toContainText('Off')
    await page.locator('[data-testid$="btnMuteNotifications"]').click()
    await expect(muteBadge).toContainText('On')

    // 2. Read receipts toggle
    const rrStatus = page.locator('[ref$="readReceiptsStatusText"]')
    await expect(rrStatus).toContainText('On')
    await page.locator('[data-testid$="btnReadReceipts"]').click()
    await expect(rrStatus).toContainText('Off')
  })

  test('should display warning and execute blocking flow on confirmation', async ({ page }) => {
    await page.locator('[ref$="btnDetails"] button').click()
    await page.locator('[data-testid$="accordion-privacy-btn"]').click()

    // Open block modal
    await page.locator('[data-testid$="btnBlock"]').click()
    const blockModal = page.locator('[data-testid$="userBlockModal"]')
    await expect(blockModal.locator('.modal')).toBeVisible()

    // Verify bold section target user's name warning (matches case-insensitively)
    await expect(blockModal.locator('[data-testid$="blockTargetTitle"]')).toContainText(/Block bob\?/i)

    // Confirm Block
    await blockModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(blockModal.locator('.modal')).not.toBeVisible()

    // Assert target user's ID is in blocked list
    const isBlocked = await page.evaluate(() => {
      const blockList = window.$state.currentUser?.blocked_users || []
      return blockList.includes('bob')
    })
    expect(isBlocked).toBe(true)
  })

  test('generate verification screenshot and video', async ({ page }) => {
    // Open Offcanvas
    await page.locator('[ref$="btnDetails"] button').click()
    
    // Expand Customise Chat
    await page.locator('[data-testid$="accordion-customise-btn"]').click()
    
    // Click Change theme
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    
    // Select Ocean theme
    await page.locator('[data-testid$="theme-ocean-item"]').click()

    // Take screenshot
    await page.screenshot({ path: '/home/jules/verification/screenshots/verification.png' })

    // Save Theme
    await page.locator('[data-testid$="themeSelectorModal"] atoll-button[ref$="primaryBtn"] button').click()

    // Wait for the modal to close and the theme to apply
    await page.waitForTimeout(1000)
    
    // Click edit nicknames
    await page.locator('[data-testid$="btnEditNicknames"]').click()
    
    // Highlight Bob
    await page.locator('[data-testid$="nicknamesModal"] atoll-list-item').filter({ hasText: /bob/i }).click()
    
    // Fill nickname
    await page.locator('[data-testid$="nicknamesModal"] input[type="text"]').fill('Bobby')
    await page.locator('[data-testid$="nicknamesModal"] button.btn-success').click()
    
    // Save
    await page.locator('[data-testid$="nicknamesModal"] atoll-button[ref$="primaryBtn"] button').click()

    await page.waitForTimeout(1000)
  })
})
