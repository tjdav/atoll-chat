import { test, expect } from './fixtures/base-test.js'

test.describe('Chat View Theme System E2E', () => {
  test.beforeEach(async ({ page, loginCustomPage }) => {
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
    await expect(page).toHaveURL(/\/\?view=chats$/)

    // Create room with Bob
    await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    await expect(page.locator('chat-view')).toBeVisible()
  })

  test('should apply and switch themes, updating computed colors on chat view container', async ({ page }) => {
    // Open room details sidebar (Customisation section is expanded by default)
    await page.locator('[ref$="btnDetails"] button').click()

    const themeModal = page.locator('.modal').filter({ hasText: 'Preview and select theme' })
    const chatContainer = page.locator('[data-testid$="chat-view-container"]')

    // Select Ocean Theme
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    await expect(themeModal).toBeVisible()
    await page.locator('[data-testid$="theme-ocean-item"]').click()
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal).not.toBeVisible()

    await expect(chatContainer).toHaveAttribute('data-theme', 'ocean')
    const oceanBgColor = await chatContainer.evaluate((el) => window.getComputedStyle(el).backgroundColor)
    expect(oceanBgColor).toBe('rgb(15, 32, 39)')

    // Switch to Forest Theme
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    await expect(themeModal).toBeVisible()
    await page.locator('[data-testid$="theme-forest-item"]').click()
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal).not.toBeVisible()

    await expect(chatContainer).toHaveAttribute('data-theme', 'forest')
    const forestBgColor = await chatContainer.evaluate((el) => window.getComputedStyle(el).backgroundColor)
    expect(forestBgColor).toBe('rgb(17, 153, 142)')

    // Switch to Sunset Theme
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    await expect(themeModal).toBeVisible()
    await page.locator('[data-testid$="theme-sunset-item"]').click()
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal).not.toBeVisible()

    await expect(chatContainer).toHaveAttribute('data-theme', 'sunset')
    const sunsetBgColor = await chatContainer.evaluate((el) => window.getComputedStyle(el).backgroundColor)
    expect(sunsetBgColor).toBe('rgb(241, 39, 17)')

    // Switch back to Classic Theme
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    await expect(themeModal).toBeVisible()
    await page.locator('[data-testid$="theme-classic-item"]').click()
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal).not.toBeVisible()

    await expect(chatContainer).toHaveAttribute('data-theme', 'classic')
  })

  test('should allow user to upload custom image, generate palette, adjust sliders, and persist custom theme', async ({ page }) => {
    // Open room details sidebar (Customisation section is expanded by default)
    await page.locator('[ref$="btnDetails"] button').click()

    const themeModal = page.locator('.modal').filter({ hasText: 'Preview and select theme' })
    const chatContainer = page.locator('[data-testid$="chat-view-container"]')

    // Open Theme selector modal
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    await expect(themeModal).toBeVisible()

    // Select Custom Theme
    await page.locator('[data-testid$="theme-custom-item"]').click()

    // Custom theme controls container should be visible
    const customControls = page.locator('[data-testid$="custom-theme-controls"]')
    await expect(customControls).toBeVisible()

    // Verify buttons are initially disabled before upload
    const btnGenerate = customControls.locator('[data-testid$="btn-generate-palette"]')
    const btnRandomize = customControls.locator('[data-testid$="btn-randomize-colors"]')
    await expect(btnGenerate).toBeDisabled()
    await expect(btnRandomize).toBeDisabled()

    // Simulating file upload - we can use a small 1x1 pixel PNG buffer
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

    // Once uploaded and loaded, buttons should become enabled
    await expect(btnGenerate).toBeEnabled()
    await expect(btnRandomize).toBeEnabled()

    // Verify Active Palette swatches render
    const swatchList = customControls.locator('[data-testid$="swatch-list"]')
    await expect(swatchList).toBeVisible()

    // Click Generate New Palette to cycle through strategies
    await btnGenerate.click()
    // Click Randomize to verify shuffling works
    await btnRandomize.click()

    // Turn on background image toggle
    const bgImageToggle = customControls.locator('[data-testid$="use-bg-image-toggle"]')
    await bgImageToggle.check()

    // Slider containers should become visible
    const slidersContainer = customControls.locator('[data-testid$="bg-sliders-container"]')
    await expect(slidersContainer).toBeVisible()

    // Adjust blur and dimming sliders
    const blurSlider = customControls.locator('[data-testid$="blur-slider"]')
    await blurSlider.fill('15')
    const dimSlider = customControls.locator('[data-testid$="dim-slider"]')
    await dimSlider.fill('60')

    // Click select to apply and save
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal).not.toBeVisible()

    // Verify custom theme attributes are applied on chatView container
    await expect(chatContainer).toHaveAttribute('data-theme', 'custom')

    // Retrieve computed variables from container to assert WCAG contrast standards & slider values
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

    // Assert luminance/contrast ratio meets the >= 4.5 ratio
    const calculateContrast = (bg, fg) => {
      const getLuminance = (rgbStr) => {
        // Handle hex conversion to RGB if not returned as rgb(...) format
        if (rgbStr.startsWith('#')) {
          let cleanHex = rgbStr.replace(/^#/, '')
          if (cleanHex.length === 3) {
            cleanHex = cleanHex.split('').map(c => c + c).join('')
          }
          const num = parseInt(cleanHex, 16)
          const r = (num >> 16) & 255
          const g = (num >> 8) & 255
          const b = num & 255
          const parseChannel = (c) => {
            const val = c / 255
            return val <= 0.04045 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
          }
          return 0.2126 * parseChannel(r) + 0.7152 * parseChannel(g) + 0.0722 * parseChannel(b)
        }

        const parts = rgbStr.match(/\d+/g).map(Number)
        const parseChannel = (c) => {
          const val = c / 255
          return val <= 0.04045 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * parseChannel(parts[0]) + 0.7152 * parseChannel(parts[1]) + 0.0722 * parseChannel(parts[2])
      }
      const l1 = getLuminance(bg)
      const l2 = getLuminance(fg)
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    }

    const contrastSent = calculateContrast(sentBg, sentColor)
    expect(contrastSent).toBeGreaterThanOrEqual(4.5)

    const contrastReceived = calculateContrast(receivedBg, receivedColor)
    expect(contrastReceived).toBeGreaterThanOrEqual(4.5)
  })
})
