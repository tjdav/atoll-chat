import { test, expect } from './fixtures/base-test.js'
import AxeBuilder from '@axe-core/playwright'
import path from 'path'

const THEMES = [
  {
    id: 'classic',
    name: 'Classic Light'
  },
  {
    id: 'classic-dark',
    selectorId: 'classic',
    isDark: true,
    name: 'Classic Dark'
  },
  {
    id: 'ocean',
    name: 'Ocean'
  },
  {
    id: 'forest',
    name: 'Forest'
  },
  {
    id: 'sunset',
    name: 'Sunset'
  },
  {
    id: 'custom',
    name: 'Custom'
  }
]

test.describe('Automated Accessibility (axe-core) & Theme Matrix Audits', () => {
  test('should pass WCAG 2.1/2.2 AA & color-contrast audit for all 6 themes', async ({ browser, loginCustomPage }) => {
    test.setTimeout(180000)

    // Setup dual browser contexts for Alice and Bob
    const aliceContext = await browser.newContext()
    const bobContext = await browser.newContext()

    const alicePage = await aliceContext.newPage()
    const bobPage = await bobContext.newPage()

    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

    // Alice creates a chat room with Bob
    await alicePage.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await alicePage.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
    await alicePage.locator('[data-testid$="search-result-bob"]').click()
    await alicePage.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    await expect(alicePage.locator('chat-view')).toBeVisible({ timeout: 15000 })

    // Message type 1: Text Sent Message (Alice)
    const textMsg = 'Hello Bob, testing accessibility text message ' + Date.now()
    await alicePage.fill('textarea', textMsg)
    await alicePage.click('[data-testid$="__sendButton"]')
    await expect(alicePage.locator('message-timeline .bubble-sent').first()).toBeVisible({ timeout: 15000 })

    // Bob opens the room with Alice
    const bobChat = bobPage.locator('chat-list chat-list-item').filter({ hasText: 'Alice' }).first()
    await expect(bobChat).toBeVisible({ timeout: 30000 })
    await bobChat.locator('atoll-list-item').click()
    await expect(bobPage.locator('chat-view')).toBeVisible({ timeout: 15000 })

    // Message type 2: Text Received Message (Bob sends to Alice)
    await bobPage.fill('textarea', 'Hi Alice, receiving text message for contrast audit')
    await bobPage.click('[data-testid$="__sendButton"]')
    await expect(alicePage.locator('message-timeline .bubble-received').first()).toBeVisible({ timeout: 20000 })

    // Message type 3: Voice / Audio Waveform Player (Alice uploads test.mp3)
    const audioPath = path.resolve('tests/e2e/fixtures/test-files/test.mp3')
    await alicePage.setInputFiles('[data-testid$="__fileInput"]', audioPath)
    await expect(alicePage.locator('chat-attachment-preview .attachment-preview-status')).toContainText('Ready to send', { timeout: 45000 })
    await alicePage.locator('[data-testid$="sendButton"]').click()
    await expect(alicePage.locator('message-timeline .waveform-player').first()).toBeVisible({ timeout: 60000 })

    // Message type 4: File Attachment Card (Alice uploads test.doc)
    const filePath = path.resolve('tests/e2e/fixtures/test-files/test.doc')
    await alicePage.setInputFiles('[data-testid$="__fileInput"]', filePath)
    await expect(alicePage.locator('chat-attachment-preview .attachment-preview-status')).toContainText('Ready to send', { timeout: 45000 })
    await alicePage.locator('[data-testid$="sendButton"]').click()
    await expect(alicePage.locator('message-timeline .file-attachment-container').first()).toBeVisible({ timeout: 60000 })

    // Message type 5: Link Preview Card (Alice sends link)
    await alicePage.fill('textarea', 'Check out https://example.com for documentation')
    await alicePage.click('[data-testid$="__sendButton"]')
    await expect(alicePage.locator('message-timeline .bubble-sent').last()).toBeVisible({ timeout: 15000 })

    // Message type 6: Reaction Pill (Bob reacts to Alice's text message)
    const rowOnBob = bobPage.locator('timeline-row').filter({ hasText: textMsg })
    await expect(rowOnBob).toBeVisible({ timeout: 20000 })
    const targetUuid = await rowOnBob.getAttribute('data-local-uuid')
    if (targetUuid) {
      await bobPage.evaluate(({ uuid }) => {
        if (window.$bus) {
          window.$bus.emit('message:send_reaction', {
            targetId: uuid,
            content: {
              type: 'emoji',
              value: '👍'
            }
          })
        }
      }, { uuid: targetUuid })
    }
    await expect(alicePage.locator('message-timeline .reaction-consolidated-pill').first()).toBeVisible({ timeout: 20000 })

    // Loop through all 6 themes
    for (const theme of THEMES) {
      console.log(`Running accessibility audit for theme: ${theme.name}`)

      // If dark mode testing, set dark mode attribute on root
      if (theme.isDark) {
        await alicePage.evaluate(() => {
          document.documentElement.setAttribute('data-bs-theme', 'dark')
          document.documentElement.setAttribute('data-atoll-theme', 'dark')
        })
      } else {
        await alicePage.evaluate(() => {
          document.documentElement.removeAttribute('data-bs-theme')
          document.documentElement.removeAttribute('data-atoll-theme')
        })
      }

      // Open Room Details Offcanvas & Theme Selector Modal
      const roomSettingsBtn = alicePage.locator('[data-testid$="btnRoomSettings"]')
      await expect(roomSettingsBtn).toBeVisible({ timeout: 15000 })
      await roomSettingsBtn.click()
      await expect(alicePage.locator('[data-testid$="btnChangeTheme"]')).toBeVisible({ timeout: 15000 })

      const themeModal = alicePage.locator('.modal').filter({ hasText: 'Preview and select theme' })
      await alicePage.locator('[data-testid$="btnChangeTheme"]').click()
      await expect(themeModal).toBeVisible({ timeout: 15000 })

      // Select target theme item
      const selectorId = theme.selectorId || theme.id
      await alicePage.locator(`[data-theme-id="${selectorId}"]`).click()

      if (theme.id === 'custom') {
        const customControls = alicePage.locator('[data-testid$="custom-theme-controls"]')
        await expect(customControls).toBeVisible({ timeout: 15000 })

        const fileInput = customControls.locator('[data-testid$="custom-image-uploader"]')
        const buffer = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5OrkJggg==',
          'base64'
        )
        await fileInput.setInputFiles({
          name: 'pattern.png',
          mimeType: 'image/png',
          buffer
        })

        const bgImageToggle = customControls.locator('[data-testid$="use-bg-image-toggle"]')
        await bgImageToggle.check()
      }

      // Apply theme in modal and wait for modal backdrop to fully disappear
      await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
      await expect(themeModal).not.toBeVisible({ timeout: 15000 })
      await expect(alicePage.locator('.modal-backdrop')).not.toBeVisible({ timeout: 15000 })

      // Close Room Details Offcanvas via DOM event dispatch and wait for offcanvas backdrop to fully disappear
      await alicePage.evaluate(() => {
        const closeBtn = document.querySelector('[data-testid="sidebar-close-btn"]') || document.querySelector('#roomDetailsOffcanvas .btn-close')
        if (closeBtn) {
          closeBtn.click()
        }
      })
      await expect(alicePage.locator('.offcanvas-backdrop')).not.toBeVisible({ timeout: 15000 })
      await alicePage.waitForTimeout(1000)

      // Assert live Chat View theme data attribute
      const chatContainer = alicePage.locator('[data-testid$="chat-view-container"]')
      await expect(chatContainer).toHaveAttribute('data-theme', selectorId)

      // Wait for layout/style computation to apply the theme's background color on the file card
      if (selectorId !== 'classic') {
        const fileCard = alicePage.locator('.file-attachment-container').first()
        await expect(fileCard).not.toHaveCSS('background-color', 'rgb(245, 245, 245)', { timeout: 15000 })
        await expect(fileCard).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)', { timeout: 15000 })
      }

      // Run axe-core WCAG 2.1 & 2.2 AA and color-contrast audit on live hydrated chat view
      const axeResults = await new AxeBuilder({ page: alicePage })
        .include('chat-view')
        .exclude('.modal')
        .exclude('.offcanvas')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()

      expect(axeResults.violations).toEqual([])
    }

    await aliceContext.close()
    await bobContext.close()
  })
})
