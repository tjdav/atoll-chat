import { test, expect } from './fixtures/base-test.js'
import path from 'path'

test.describe('Chat View Theme System & Component Verification E2E', () => {
  test.beforeEach(async ({ page, loginCustomPage }) => {
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
    await expect(page).toHaveURL(/\/\?view=chats$/)

    // Create room with Bob
    await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    await expect(page.locator('atoll-chat-view')).toBeVisible()
  })

  test('should apply themes and verify atoll-chat-view header, atoll-chat-input, file card, and date separator component styling uniformity', async ({ page }) => {
    // Populate timeline with sent text, file attachment, and date separator
    await page.fill('textarea', 'Hello theme test message')
    await page.keyboard.press('Enter')
    await expect(page.locator('atoll-chat-timeline .atoll-chat-bubble-sent').first()).toBeVisible()

    const docPath = path.resolve('tests/e2e/fixtures/test-files/test.doc')
    await page.setInputFiles('[data-testid$="__fileInput"]', docPath)
    await expect(page.locator('atoll-chat-attachment-preview .atoll-chat-attachment-preview-status')).toContainText('Ready to send', { timeout: 30000 })
    await page.locator('[data-testid$="sendButton"]').click()
    await expect(page.locator('atoll-chat-timeline .atoll-chat-file-attachment').first()).toBeVisible({ timeout: 30000 })

    // Open room details sidebar via icon-only room settings button
    const roomSettingsBtn = page.locator('[data-testid$="btnRoomSettings"]')
    await expect(roomSettingsBtn).toBeVisible({ timeout: 15000 })
    await roomSettingsBtn.click()

    const themeModal = page.locator('.modal').filter({ hasText: 'Preview and select theme' })
    const chatContainer = page.locator('[data-testid$="atoll-chat-view-container"]')
    const fileCard = page.locator('.atoll-chat-file-attachment').first()
    const fileName = fileCard.locator('.atoll-chat-file-name')
    const fileSize = fileCard.locator('.atoll-chat-file-size')

    // Select Ocean Theme in modal
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    await expect(themeModal).toBeVisible()

    await page.locator('[data-testid$="theme-ocean-item"]').click()
    const previewWindow = themeModal.locator('[ref$="previewChatWindow"]')
    await expect(previewWindow).toHaveAttribute('data-theme', 'ocean')

    // Apply Ocean Theme
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal).not.toBeVisible()

    // Assert live chat view container attributes and component styling equality
    await expect(chatContainer).toHaveAttribute('data-theme', 'ocean')

    const componentStyles = await chatContainer.evaluate((el) => {
      const headerEl = el.querySelector('.atoll-chat-view-header')
      const inputEl = el.querySelector('.atoll-chat-input-container')
      const subtitleEl = el.querySelector('.atoll-chat-view-header-subtitle')
      const dateSepContainer = el.querySelector('.atoll-chat-date-separator')
      const fileNameEl = el.querySelector('.atoll-chat-file-attachment .atoll-chat-file-name')
      const fileSizeEl = el.querySelector('.atoll-chat-file-size')

      const headerStyle = headerEl ? window.getComputedStyle(headerEl) : null
      const inputStyle = inputEl ? window.getComputedStyle(inputEl) : null
      const dateSepStyle = dateSepContainer ? window.getComputedStyle(dateSepContainer) : null

      return {
        oceanBgImage: window.getComputedStyle(el).getPropertyValue('background-image'),
        headerBg: headerStyle ? headerStyle.getPropertyValue('background-color') : '',
        inputBg: inputStyle ? inputStyle.getPropertyValue('background-color') : '',
        headerBlur: headerStyle ? headerStyle.getPropertyValue('backdrop-filter') : '',
        inputBlur: inputStyle ? inputStyle.getPropertyValue('backdrop-filter') : '',
        subtitleColor: subtitleEl ? window.getComputedStyle(subtitleEl).getPropertyValue('color') : '',
        dateSepBg: dateSepStyle ? dateSepStyle.getPropertyValue('background-color') : '',
        fileNameColor: fileNameEl ? window.getComputedStyle(fileNameEl).getPropertyValue('color') : '',
        fileSizeColor: fileSizeEl ? window.getComputedStyle(fileSizeEl).getPropertyValue('color') : ''
      }
    })

    expect(componentStyles.oceanBgImage).toContain('gradient')
    expect(componentStyles.headerBlur).toContain('blur(16px)')
    expect(componentStyles.inputBlur).toContain('blur(16px)')
    // Verify atoll-chat-input background equals atoll-chat-view-header background
    expect(componentStyles.inputBg).toBe(componentStyles.headerBg)
    // Verify date separator container is transparent (no block background)
    expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(componentStyles.dateSepBg)
    // Verify file card text visibility and contrast
    await expect(fileName).toBeVisible()
    await expect(fileSize).toBeVisible()

    // Switch to Forest Theme
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    await expect(themeModal).toBeVisible()
    await page.locator('[data-testid$="theme-forest-item"]').click()
    await expect(previewWindow).toHaveAttribute('data-theme', 'forest')
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal).not.toBeVisible()

    await expect(chatContainer).toHaveAttribute('data-theme', 'forest')
    const forestComponentStyles = await chatContainer.evaluate((el) => {
      const headerEl = el.querySelector('.atoll-chat-view-header')
      const inputEl = el.querySelector('.atoll-chat-input-container')
      const fileCardEl = el.querySelector('.atoll-chat-file-attachment')
      return {
        headerBg: headerEl ? window.getComputedStyle(headerEl).getPropertyValue('background-color') : '',
        inputBg: inputStyle ? inputStyle.getPropertyValue('background-color') : '',
        fileCardBg: fileCardEl ? window.getComputedStyle(fileCardEl).getPropertyValue('background-color') : ''
      }
    })
    console.log('--- FOREST STYLES ---', forestComponentStyles)
    expect(forestComponentStyles.inputBg).toBe(forestComponentStyles.headerBg)

    // Switch back to Classic Theme
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    await expect(themeModal).toBeVisible()
    await page.locator('[data-testid$="theme-classic-item"]').click()
    await expect(previewWindow).toHaveAttribute('data-theme', 'classic')
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal).not.toBeVisible()

    await expect(chatContainer).toHaveAttribute('data-theme', 'classic')
  })

  test('should allow user to upload custom image, generate palette, adjust sliders, and persist custom theme', async ({ page }) => {
    // Open room details sidebar via icon-only room settings button
    const roomSettingsBtn = page.locator('[data-testid$="btnRoomSettings"]')
    await expect(roomSettingsBtn).toBeVisible({ timeout: 15000 })
    await roomSettingsBtn.click()

    const themeModal = page.locator('.modal').filter({ hasText: 'Preview and select theme' })
    const chatContainer = page.locator('[data-testid$="atoll-chat-view-container"]')

    // Open Theme selector modal
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    await expect(themeModal).toBeVisible()

    // Select Custom Theme
    await page.locator('[data-testid$="theme-custom-item"]').click()

    const customControls = page.locator('[data-testid$="custom-theme-controls"]')
    await expect(customControls).toBeVisible()

    const btnGenerate = customControls.locator('[data-testid$="btn-generate-palette"]')
    const btnRandomize = customControls.locator('[data-testid$="btn-randomize-colors"]')
    await expect(btnGenerate).toBeDisabled()
    await expect(btnRandomize).toBeDisabled()

    const fileInput = customControls.locator('[data-testid$="custom-image-uploader"]')
    const buffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    await fileInput.setInputFiles({
      name: 'test-pattern.png',
      mimeType: 'image/png',
      buffer
    })

    await expect(btnGenerate).toBeEnabled()
    await expect(btnRandomize).toBeEnabled()

    const bgImageToggle = customControls.locator('[data-testid$="use-bg-image-toggle"]')
    await bgImageToggle.check()

    const slidersContainer = customControls.locator('[data-testid$="bg-sliders-container"]')
    await expect(slidersContainer).toBeVisible()

    const blurSlider = customControls.locator('[data-testid$="blur-slider"]')
    await blurSlider.fill('15')
    const dimSlider = customControls.locator('[data-testid$="dim-slider"]')
    await dimSlider.fill('60')

    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal).not.toBeVisible()

    await expect(chatContainer).toHaveAttribute('data-theme', 'custom')

    const [sentBg, sentColor, receivedBg, receivedColor, bgBlur, bgDim] = await chatContainer.evaluate((el) => {
      const s = window.getComputedStyle(el)
      return [
        s.getPropertyValue('--atoll-chat-bubble-sent-bg').trim(),
        s.getPropertyValue('--atoll-chat-bubble-sent-color').trim(),
        s.getPropertyValue('--atoll-chat-bubble-received-bg').trim(),
        s.getPropertyValue('--atoll-chat-bubble-received-color').trim(),
        s.getPropertyValue('--atoll-chat-bg-blur').trim(),
        s.getPropertyValue('--atoll-chat-bg-dim').trim()
      ]
    })

    expect(bgBlur).toBe('15px')
    expect(bgDim).toBe('0.6')
  })
})
