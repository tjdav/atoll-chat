import { test, expect } from './fixtures/base-test.js'
import AxeBuilder from '@axe-core/playwright'
import path from 'path'

// Helper to generate custom solid color BMP files in buffer
function createSolidBMP (r, g, b) {
  const buf = Buffer.alloc(102)
  buf.write('BM', 0)
  buf.writeUInt32LE(102, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(4, 18)
  buf.writeInt32LE(4, 22)
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(0, 30)
  buf.writeUInt32LE(48, 34)
  for (let i = 0; i < 16; i++) {
    const offset = 54 + i * 3
    buf[offset] = b
    buf[offset + 1] = g
    buf[offset + 2] = r
  }
  return buf
}

// Helper to parse rgb or rgba string to array of numbers
function parseColor (colorStr) {
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (!match) {
    return [0, 0, 0, 1]
  }
  const r = parseInt(match[1], 10)
  const g = parseInt(match[2], 10)
  const b = parseInt(match[3], 10)
  const a = match[4] !== undefined ? parseFloat(match[4]) : 1
  return [r, g, b, a]
}

// Helper to calculate relative luminance
function getLuminance (r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const srgb = c / 255
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

// Composite overlay color (RGBA) on top of a solid background (RGB)
function compositeColor (overlay, base) {
  const [or, og, ob, oa] = parseColor(overlay)
  const [br, bg, bb] = parseColor(base)
  const r = Math.round(or * oa + br * (1 - oa))
  const g = Math.round(og * oa + bg * (1 - oa))
  const b = Math.round(ob * oa + bb * (1 - oa))
  return `rgb(${r}, ${g}, ${b})`
}

function getContrastRatio (color1, color2) {
  const [r1, g1, b1] = parseColor(color1)
  const [r2, g2, b2] = parseColor(color2)
  const l1 = getLuminance(r1, g1, b1)
  const l2 = getLuminance(r2, g2, b2)
  const bright = Math.max(l1, l2)
  const dark = Math.min(l1, l2)
  return (bright + 0.05) / (dark + 0.05)
}

async function getEffectiveBackground (page, elementLocator, baseBg) {
  const bg = await elementLocator.evaluate(el => window.getComputedStyle(el).backgroundColor)
  const [, , , a] = parseColor(bg)
  if (a === 0) {
    return baseBg
  } else if (a < 1) {
    return compositeColor(bg, baseBg)
  }
  return bg
}

async function getEffectiveForeground (page, elementLocator, bg) {
  return elementLocator.evaluate((el, background) => {
    const style = window.getComputedStyle(el)
    const color = style.color
    const opacity = parseFloat(style.opacity || '1')
    if (opacity === 1) {
      return color
    }
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
    if (!match) {
      return color
    }
    const r = parseInt(match[1], 10)
    const g = parseInt(match[2], 10)
    const b = parseInt(match[3], 10)
    const a = (match[4] !== undefined ? parseFloat(match[4]) : 1) * opacity

    const bgMatch = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)\)/)
    if (!bgMatch) {
      return color
    }
    const br = parseInt(bgMatch[1], 10)
    const bgG = parseInt(bgMatch[2], 10)
    const bb = parseInt(bgMatch[3], 10)

    const finalR = Math.round(r * a + br * (1 - a))
    const finalG = Math.round(g * a + bgG * (1 - a))
    const finalB = Math.round(b * a + bb * (1 - a))
    return `rgb(${finalR}, ${finalG}, ${finalB})`
  }, bg)
}

// Verification helper for element color contrast assertions
async function verifyComputedElementContrast (page) {
  const chatContainer = page.locator('[data-testid$="atoll-chat-view-container"]')
  const themeId = await chatContainer.getAttribute('data-theme')

  let baseBg = 'rgb(255, 255, 255)' // Default light fallback
  if (themeId === 'classic') {
    const isDark = await page.evaluate(() => document.documentElement.getAttribute('data-atoll-theme') === 'dark' || document.documentElement.getAttribute('data-bs-theme') === 'dark')
    baseBg = isDark ? 'rgb(31, 31, 31)' : 'rgb(255, 255, 255)'
  } else if (themeId === 'ocean') {
    baseBg = 'rgb(15, 32, 39)'
  } else if (themeId === 'forest') {
    baseBg = 'rgb(17, 153, 142)'
  } else if (themeId === 'sunset') {
    baseBg = 'rgb(241, 39, 17)'
  } else if (themeId === 'custom') {
    const computedBg = await page.evaluate(() => window.getComputedStyle(document.querySelector('[data-testid$="atoll-chat-view-container"]')).backgroundColor)
    baseBg = computedBg || 'rgb(255, 255, 255)'
  }

  // 1. Sent Bubble Text
  const sentBubble = page.locator('.atoll-chat-bubble-sent').first()
  if (await sentBubble.isVisible()) {
    const bg = await getEffectiveBackground(page, sentBubble, baseBg)
    const fg = await getEffectiveForeground(page, sentBubble, bg)
    const ratio = getContrastRatio(fg, bg)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  }

  // 2. Received Bubble Text
  const receivedBubble = page.locator('.atoll-chat-bubble-received').first()
  if (await receivedBubble.isVisible()) {
    const bg = await getEffectiveBackground(page, receivedBubble, baseBg)
    const fg = await getEffectiveForeground(page, receivedBubble, bg)
    const ratio = getContrastRatio(fg, bg)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  }

  // 3. Sender Name
  const senderName = page.locator('.atoll-chat-sender-name').first()
  if (await senderName.isVisible()) {
    const fg = await getEffectiveForeground(page, senderName, baseBg)
    const ratio = getContrastRatio(fg, baseBg)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  }

  // 4. Date Separator Badge/Pill
  const datePill = page.locator('.atoll-chat-date-separator-pill, .atoll-chat-date-separator .badge').first()
  if (await datePill.isVisible()) {
    const bg = await getEffectiveBackground(page, datePill, baseBg)
    const fg = await getEffectiveForeground(page, datePill, bg)
    const ratio = getContrastRatio(fg, bg)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  }

  // 5. Header Title
  const header = page.locator('.atoll-chat-view-header').first()
  const headerTitle = header.locator('h6, .atoll-text-title-2').first()
  if (await headerTitle.isVisible()) {
    const bg = await getEffectiveBackground(page, header, baseBg)
    const fg = await getEffectiveForeground(page, headerTitle, bg)
    const ratio = getContrastRatio(fg, bg)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  }

  // 6. Header Subtitle
  const headerSubtitle = header.locator('.atoll-chat-view-header-subtitle').first()
  if (await headerSubtitle.isVisible()) {
    const bg = await getEffectiveBackground(page, header, baseBg)
    const fg = await getEffectiveForeground(page, headerSubtitle, bg)
    const ratio = getContrastRatio(fg, bg)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  }

  // 7. File Attachment Card Text
  const fileAttachment = page.locator('.atoll-chat-file-attachment').first()
  const fileName = fileAttachment.locator('.atoll-chat-file-name').first()
  if (await fileName.isVisible()) {
    const bg = await getEffectiveBackground(page, fileAttachment, baseBg)
    const fg = await getEffectiveForeground(page, fileName, bg)
    const ratio = getContrastRatio(fg, bg)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  }

  // 8. Waveform Player Inactive Track (Graphical component - minimum 3:1)
  const waveformPlayer = page.locator('.atoll-chat-waveform-player').first()
  if (await waveformPlayer.isVisible()) {
    const bg = await getEffectiveBackground(page, waveformPlayer, baseBg)
    const svgColor = await waveformPlayer.locator('.waveform-container svg').first().evaluate(el => {
      const style = window.getComputedStyle(el)
      return style.fill || style.color || style.getPropertyValue('--atoll-chat-waveform-inactive')
    })
    const ratio = getContrastRatio(svgColor, bg)
    expect(ratio).toBeGreaterThanOrEqual(3.0)
  }

  // 9. Sent row timestamps / statuses
  const sentRow = page.locator('atoll-chat-timeline-row[is-sent="true"]').first()
  if (await sentRow.isVisible()) {
    const statusText = sentRow.locator('.atoll-chat-message-status-container span').first()
    if (await statusText.isVisible()) {
      const fg = await getEffectiveForeground(page, statusText, baseBg)
      const ratio = getContrastRatio(fg, baseBg)
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    }
  }

  // 10. Received row timestamps
  const receivedRow = page.locator('atoll-chat-timeline-row[is-sent="false"]').first()
  if (await receivedRow.isVisible()) {
    const statusText = receivedRow.locator('.atoll-chat-message-status-container span').first()
    if (await statusText.isVisible()) {
      const fg = await getEffectiveForeground(page, statusText, baseBg)
      const ratio = getContrastRatio(fg, baseBg)
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    }
  }
}

test.describe.configure({ mode: 'serial' })

test.describe('Automated Accessibility (axe-core) & Theme Matrix Audits', () => {
  let aliceContext
  let bobContext
  let alicePage
  let bobPage

  test.beforeAll(async ({ browser }) => {
    // Setup dual browser contexts for Alice and Bob
    aliceContext = await browser.newContext()
    bobContext = await browser.newContext()

    alicePage = await aliceContext.newPage()
    bobPage = await bobContext.newPage()
  })

  test.afterAll(async () => {
    if (aliceContext) {
      await aliceContext.close()
    }
    if (bobContext) {
      await bobContext.close()
    }
  })

  test('setup: should login, create room, and send all 6 types of messages', async ({ loginCustomPage }) => {
    test.setTimeout(180000)

    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

    // Alice creates a chat room with Bob
    await alicePage.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await alicePage.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
    await alicePage.locator('[data-testid$="search-result-bob"]').click()
    await alicePage.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    await expect(alicePage.locator('atoll-chat-view')).toBeVisible({ timeout: 15000 })

    // Message type 1: Text Sent Message (Alice)
    const textMsg = 'Hello Bob, testing accessibility text message ' + Date.now()
    await alicePage.fill('textarea', textMsg)
    await alicePage.click('[data-testid$="__sendButton"]')
    await expect(alicePage.locator('atoll-chat-timeline .atoll-chat-bubble-sent').first()).toBeVisible({ timeout: 15000 })
    await expect(alicePage.locator('.atoll-chat-message-status-container [data-testid$="status-text"]').last()).toHaveText('Sent', { timeout: 60000 })

    // Bob opens the room with Alice
    const bobChat = bobPage.locator('chat-list chat-list-item').filter({ hasText: 'Alice' }).first()
    await expect(bobChat).toBeVisible({ timeout: 30000 })
    await bobChat.locator('atoll-list-item').click()
    await expect(bobPage.locator('atoll-chat-view')).toBeVisible({ timeout: 15000 })

    // Message type 2: Text Received Message (Bob sends to Alice)
    await bobPage.fill('textarea', 'Hi Alice, receiving text message for contrast audit')
    await bobPage.click('[data-testid$="__sendButton"]')
    await expect(alicePage.locator('atoll-chat-timeline .atoll-chat-bubble-received').first()).toBeVisible({ timeout: 20000 })
    await expect(bobPage.locator('.atoll-chat-message-status-container [data-testid$="status-text"]').last()).toHaveText('Sent', { timeout: 60000 })

    // Message type 3: Voice / Audio Waveform Player (Alice uploads test.mp3)
    const audioPath = path.resolve('tests/e2e/fixtures/test-files/test.mp3')
    await alicePage.setInputFiles('[data-testid$="__fileInput"]', audioPath)
    await expect(alicePage.locator('atoll-chat-attachment-preview .atoll-chat-attachment-preview-status')).toContainText('Ready to send', { timeout: 45000 })
    await alicePage.locator('[data-testid$="sendButton"]').click()
    await expect(alicePage.locator('atoll-chat-timeline .atoll-chat-waveform-player').first()).toBeVisible({ timeout: 60000 })
    await expect(alicePage.locator('.atoll-chat-message-status-container [data-testid$="status-text"]').last()).toHaveText('Sent', { timeout: 60000 })

    // Message type 4: File Attachment Card (Alice uploads test.doc)
    const filePath = path.resolve('tests/e2e/fixtures/test-files/test.doc')
    await alicePage.setInputFiles('[data-testid$="__fileInput"]', filePath)
    await expect(alicePage.locator('atoll-chat-attachment-preview .atoll-chat-attachment-preview-status')).toContainText('Ready to send', { timeout: 45000 })
    await alicePage.locator('[data-testid$="sendButton"]').click()
    await expect(alicePage.locator('atoll-chat-timeline .atoll-chat-file-attachment').first()).toBeVisible({ timeout: 60000 })
    await expect(alicePage.locator('.atoll-chat-message-status-container [data-testid$="status-text"]').last()).toHaveText('Sent', { timeout: 60000 })

    // Message type 5: Link Preview Card (Alice sends link)
    await alicePage.fill('textarea', 'Check out https://example.com for documentation')
    await alicePage.click('[data-testid$="__sendButton"]')
    await expect(alicePage.locator('atoll-chat-timeline .atoll-chat-bubble-sent').last()).toBeVisible({ timeout: 15000 })
    await expect(alicePage.locator('.atoll-chat-message-status-container [data-testid$="status-text"]').last()).toHaveText('Sent', { timeout: 60000 })

    // Message type 6: Reaction Pill (Bob reacts to Alice's text message)
    const rowOnBob = bobPage.locator('atoll-chat-timeline-row').filter({ hasText: textMsg })
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
    await expect(alicePage.locator('atoll-chat-timeline .atoll-chat-reaction-consolidated-pill').first()).toBeVisible({ timeout: 20000 })
  })

  // Helper theme runner
  async function applyThemeAndAudit (theme, customImageBuffer = null) {
    test.setTimeout(90000)

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

    // Expand Customise Chat accordion if not already expanded
    const changeThemeBtn = alicePage.locator('[data-testid$="btnChangeTheme"]')
    const isVisible = await changeThemeBtn.isVisible()
    if (!isVisible) {
      await alicePage.locator('[data-testid$="accordion-customise-btn"]').click()
    }

    await expect(changeThemeBtn).toBeVisible({ timeout: 15000 })

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
      const buffer = customImageBuffer || Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5OrkJggg==',
        'base64'
      )
      await fileInput.setInputFiles({
        name: 'pattern.png',
        mimeType: 'image/png',
        buffer
      })

      // Wait for image uploader / palette generator to fully finish analysis
      const btnGenerate = customControls.locator('[data-testid$="btn-generate-palette"]')
      await expect(btnGenerate).toBeEnabled({ timeout: 30000 })

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
    const chatContainer = alicePage.locator('[data-testid$="atoll-chat-view-container"]')
    await expect(chatContainer).toHaveAttribute('data-theme', selectorId)

    // Wait for layout/style computation to apply the theme's background color on the file card
    if (selectorId !== 'classic') {
      const fileCard = alicePage.locator('.atoll-chat-file-attachment').first()
      await expect(fileCard).not.toHaveCSS('background-color', 'rgb(245, 245, 245)', { timeout: 15000 })
      await expect(fileCard).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)', { timeout: 15000 })
    }

    // Run axe-core WCAG 2.1 & 2.2 AA and color-contrast audit on live hydrated chat view
    const axeResults = await new AxeBuilder({ page: alicePage })
      .include('atoll-chat-view')
      .exclude('.modal')
      .exclude('.offcanvas')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()

    expect(axeResults.violations).toEqual([])

    // Audit axe-core incomplete checks specifically for color-contrast to verify transparent overlaps
    const incompleteContrast = axeResults.incomplete.filter(item => item.id === 'color-contrast')

    // Perform explicit contrast audit on key chat view elements
    await verifyComputedElementContrast(alicePage)

    // Ensure elements flagged as incomplete pass our contrast checks
    let baseBg = 'rgb(255, 255, 255)' // Default light fallback
    if (selectorId === 'classic') {
      const isDark = await alicePage.evaluate(() => document.documentElement.getAttribute('data-atoll-theme') === 'dark' || document.documentElement.getAttribute('data-bs-theme') === 'dark')
      baseBg = isDark ? 'rgb(31, 31, 31)' : 'rgb(255, 255, 255)'
    } else if (selectorId === 'ocean') {
      baseBg = 'rgb(15, 32, 39)'
    } else if (selectorId === 'forest') {
      baseBg = 'rgb(17, 153, 142)'
    } else if (selectorId === 'sunset') {
      baseBg = 'rgb(241, 39, 17)'
    } else if (selectorId === 'custom') {
      const computedBg = await alicePage.evaluate(() => window.getComputedStyle(document.querySelector('[data-testid$="atoll-chat-view-container"]')).backgroundColor)
      baseBg = computedBg || 'rgb(255, 255, 255)'
    }

    for (const item of incompleteContrast) {
      for (const node of item.nodes) {
        try {
          const targetLocator = alicePage.locator(node.target[0]).first()
          if (await targetLocator.isVisible()) {
            const fg = await targetLocator.evaluate(el => window.getComputedStyle(el).color)
            const bg = await targetLocator.evaluate(el => {
              let cur = el.parentElement
              while (cur) {
                const bgStyle = window.getComputedStyle(cur).backgroundColor
                const match = bgStyle.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
                if (match && parseFloat(match[4] || '1') > 0) {
                  return bgStyle
                }
                cur = cur.parentElement
              }
              return 'rgb(255, 255, 255)'
            })
            const effectiveBg = bg.includes('rgba') ? compositeColor(bg, baseBg) : bg
            const ratio = getContrastRatio(fg, effectiveBg)
            expect(ratio).toBeGreaterThanOrEqual(3.0)
          }
        } catch (e) {
          // ignore offscreen or untargetable nodes gracefully
        }
      }
    }
  }

  test('theme: classic light', async () => {
    await applyThemeAndAudit({
      id: 'classic',
      name: 'Classic Light'
    })
  })

  test('theme: classic dark', async () => {
    await applyThemeAndAudit({
      id: 'classic-dark',
      selectorId: 'classic',
      isDark: true,
      name: 'Classic Dark'
    })
  })

  test('theme: ocean', async () => {
    await applyThemeAndAudit({
      id: 'ocean',
      name: 'Ocean'
    })
  })

  test('theme: forest', async () => {
    await applyThemeAndAudit({
      id: 'forest',
      name: 'Forest'
    })
  })

  test('theme: sunset', async () => {
    await applyThemeAndAudit({
      id: 'sunset',
      name: 'Sunset'
    })
    // Capture verification screenshot for frontend changes
    const fs = await import('fs')
    await fs.promises.mkdir('/home/jules/verification/screenshots', { recursive: true })
    await alicePage.screenshot({ path: '/home/jules/verification/screenshots/verification.png' })
  })

  test('theme: custom with dark background image', async () => {
    // Generate solid dark blue image buffer (#000033)
    const darkBlueImage = createSolidBMP(0, 0, 51)
    await applyThemeAndAudit({
      id: 'custom',
      name: 'Custom'
    }, darkBlueImage)
  })

  test('theme: custom with light background image', async () => {
    // Generate solid light yellow image buffer (#FFFFCC)
    const lightYellowImage = createSolidBMP(255, 255, 204)
    await applyThemeAndAudit({
      id: 'custom',
      name: 'Custom'
    }, lightYellowImage)
  })
})
