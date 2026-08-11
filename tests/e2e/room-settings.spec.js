import { test, expect } from './fixtures/base-test.js'
import fs from 'fs'

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

    await expect(page.locator('atoll-chat-view')).toBeVisible()
    await expect(page.locator('atoll-chat-view header h6')).toContainText('bob')
  })

  test('should open and close the native Bootstrap Offcanvas drawer smoothly', async ({ page }) => {
    const offcanvas = page.locator('[data-testid$="roomDetailsOffcanvas"]')
    await expect(offcanvas).not.toBeVisible()

    // Open Offcanvas (Using suffix selector on compiled refs and clicking inner button)
    await page.locator('[ref$="btnDetails"] button').click()
    await expect(offcanvas).toBeVisible()

    // Assert that title is Room Settings
    await expect(offcanvas.locator('#roomDetailsOffcanvasLabel')).toContainText('Room Settings')

    // Hero section checks
    await expect(offcanvas.locator('atoll-profile[ref$="roomAvatar"]')).toBeVisible()
    await expect(offcanvas.locator('[ref$="roomNameText"]')).toContainText('bob')
    await expect(offcanvas.locator('.e2e-badge')).toContainText('End-to-End Encrypted')

    // Close Offcanvas via top-right close button
    await page.locator('[data-testid$="sidebar-close-btn"]').click()
    await expect(offcanvas).not.toBeVisible()
  })

  test('should support collapsible accordion groups starting collapsed by default and toggling independently', async ({ page }) => {
    // Open offcanvas
    await page.locator('[ref$="btnDetails"] button').click()

    const customiseCollapse = page.locator('[data-testid$="collapse-customise"]')
    const privacyCollapse = page.locator('[data-testid$="collapse-privacy"]')
    const membersCollapse = page.locator('[data-testid$="collapse-members"]')

    // Verify all 3 sections start collapsed/hidden by default
    await expect(customiseCollapse).not.toBeVisible()
    await expect(privacyCollapse).not.toBeVisible()
    await expect(membersCollapse).not.toBeVisible()

    // Expand Customise Chat independently
    await page.locator('[data-testid$="accordion-customise-btn"]').click()
    await expect(customiseCollapse).toBeVisible()
    // Verify other sections remain closed/hidden
    await expect(privacyCollapse).not.toBeVisible()
    await expect(membersCollapse).not.toBeVisible()

    // Collapse Customise Chat back
    await page.locator('[data-testid$="accordion-customise-btn"]').click()
    await expect(customiseCollapse).not.toBeVisible()

    // Expand Privacy & Support independently
    await page.locator('[data-testid$="accordion-privacy-btn"]').click()
    await expect(privacyCollapse).toBeVisible()
    // Verify other sections are not affected
    await expect(customiseCollapse).not.toBeVisible()
    await expect(membersCollapse).not.toBeVisible()

    // Collapse Privacy & Support back
    await page.locator('[data-testid$="accordion-privacy-btn"]').click()
    await expect(privacyCollapse).not.toBeVisible()
  })

  test('should launch theme selection popup and apply custom gradients', async ({ page }) => {
    await page.locator('[ref$="btnDetails"] button').click()

    // Expand Customise Chat accordion
    await page.locator('[data-testid$="accordion-customise-btn"]').click()

    // Open theme selector modal (Customise Chat is expanded by default)
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    const themeModal = page.locator('.modal').filter({ hasText: 'Preview and select theme' })
    await expect(themeModal).toBeVisible()

    // Highlight Ocean theme
    await page.locator('[data-testid$="theme-ocean-item"]').click()
    await expect(themeModal.locator('[data-testid$="checkOcean"]')).not.toHaveClass(/d-none/)

    // Save/Select Theme (Target inner button inside atoll-button wrapper)
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal).not.toBeVisible()

    // Verify main chat view container has data-theme="ocean" applied
    const chatContainer = page.locator('[data-testid$="atoll-chat-view-container"]')
    await expect(chatContainer).toHaveAttribute('data-theme', 'ocean')
  })

  test('should edit participant nicknames via nickname management inline form', async ({ page }) => {
    await page.locator('[ref$="btnDetails"] button').click()

    // Expand Customise Chat accordion
    await page.locator('[data-testid$="accordion-customise-btn"]').click()

    // Open nicknames modal (Customise Chat is expanded by default)
    await page.locator('[data-testid$="btnEditNicknames"]').click()
    const nicknamesModal = page.locator('.modal').filter({ hasText: 'Nicknames' })
    await expect(nicknamesModal).toBeVisible()

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
    await expect(nicknamesModal).not.toBeVisible()

    // Nickname is updated in room details text & chat view header!
    await expect(page.locator('[data-testid$="roomDetailsOffcanvas"] [ref$="roomNameText"]')).toContainText('Bobby')
    await expect(page.locator('atoll-chat-view header h6')).toContainText('Bobby')
  })

  test('should support privacy controls: read receipts and notifications mute toggle', async ({ page }) => {
    await page.locator('[ref$="btnDetails"] button').click()

    // Expand Privacy & support accordion
    await page.locator('[data-testid$="accordion-privacy-btn"]').click()

    // 1. Mute notifications toggle (Privacy & support is expanded by default)
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

    // Expand Privacy & support accordion
    await page.locator('[data-testid$="accordion-privacy-btn"]').click()

    // Open block modal (Privacy & support is expanded by default)
    await page.locator('[data-testid$="btnBlock"]').click()
    const blockModal = page.locator('.modal').filter({ hasText: 'Block User' })
    await expect(blockModal).toBeVisible()

    // Verify bold section target user's name warning (matches case-insensitively)
    await expect(blockModal.locator('[data-testid$="blockTargetTitle"]')).toContainText(/Block bob\?/i)

    // Confirm Block
    await blockModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(blockModal).not.toBeVisible()

    // Assert target user's ID is in blocked list
    const isBlocked = await page.evaluate(() => {
      const blockList = window.$state.currentUser?.blocked_users || []
      return blockList.includes('bob')
    })
    expect(isBlocked).toBe(true)
  })

  test('should update is_typing in room_member_states when typing in message textarea', async ({ page, request }) => {
    // Fill text in textarea
    const chatInput = page.locator('atoll-chat-input-text textarea, atoll-chat-input textarea, textarea[placeholder*="message"]').first()
    await chatInput.fill('Hi Bob, I am typing!')

    // Wait for the state to propagate to server
    const testId = await page.evaluate(() => window.__playwright_test_id__ || 'default')
    const headers = { 'x-test-id': testId }

    // Check room_member_states on the mock server
    let stateRecord = null
    for (let i = 0; i < 15; i++) {
      const res = await request.get(`http://localhost:8091/api/collections/room_member_states/records`, { headers })
      const data = await res.json()
      stateRecord = data.items.find(item => item.user_id === 'alice' && item.is_typing === true)
      if (stateRecord) {
        break
      }
      await page.waitForTimeout(300)
    }
    expect(stateRecord).toBeDefined()
    expect(stateRecord.is_typing).toBe(true)

    // Clear textarea
    await chatInput.fill('')

    // Check room_member_states on the mock server to be false
    let isTypingFalse = false
    for (let i = 0; i < 15; i++) {
      const res = await request.get(`http://localhost:8091/api/collections/room_member_states/records`, { headers })
      const data = await res.json()
      const rec = data.items.find(item => item.user_id === 'alice')
      if (rec && rec.is_typing === false) {
        isTypingFalse = true
        break
      }
      await page.waitForTimeout(300)
    }
    expect(isTypingFalse).toBe(true)
  })

  test('generate verification screenshot and video', async ({ page }) => {
    // Open Offcanvas
    await page.locator('[ref$="btnDetails"] button').click()

    // Expand Customise Chat accordion
    await page.locator('[data-testid$="accordion-customise-btn"]').click()

    // Click Change theme (Customise Chat is expanded by default)
    await page.locator('[data-testid$="btnChangeTheme"]').click()

    // Select Ocean theme
    await page.locator('[data-testid$="theme-ocean-item"]').click()

    // Save Theme
    const themeModal = page.locator('.modal').filter({ hasText: 'Preview and select theme' })
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()

    // Wait for the modal to close and the theme to apply
    await page.waitForTimeout(1000)

    // Click edit nicknames
    await page.locator('[data-testid$="btnEditNicknames"]').click()

    // Highlight Bob
    const nicknamesModal = page.locator('.modal').filter({ hasText: 'Nicknames' })
    await nicknamesModal.locator('atoll-list-item').filter({ hasText: /bob/i }).click()

    // Fill nickname
    await nicknamesModal.locator('input[type="text"]').fill('Bobby')
    await nicknamesModal.locator('button.btn-success').click()

    // Save
    await nicknamesModal.locator('atoll-button[ref$="primaryBtn"] button').click()

    // Expand Privacy & support accordion (Customise chat is already expanded)
    await page.locator('[data-testid$="accordion-privacy-btn"]').click()
    await page.waitForTimeout(1000)

    // Take screenshot
    await page.locator('[data-testid$="roomDetailsOffcanvas"]').screenshot({ path: '/home/jules/verification/screenshots/verification.png' })
  })
})
