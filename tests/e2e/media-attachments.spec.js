import { test, expect } from './fixtures/base-test.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test.describe('Media & Attachments', () => {

  test.describe('File Handling', () => {
    test('send various file types', async ({ browser, loginCustomPage }) => {
      test.setTimeout(120000)
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      const bobContext = await browser.newContext()
      const bobPage = await bobContext.newPage()
      await Promise.all([
        loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!'),
        loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
      ])
      await alicePage.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await alicePage.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
      await alicePage.locator('[data-testid$="search-result-bob"]').click()
      await alicePage.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
      const bobChat = bobPage.locator('chat-list .app-list-item').filter({ hasText: 'alice' }).first()
      await expect(bobChat).toBeVisible({ timeout: 30000 })
      await bobChat.click()

      const files = [
        {
          n: 'test.png',
          s: 'timeline-item-media img'
        },
        {
          n: 'test.mp4',
          s: 'timeline-item-media img'
        },
        {
          n: 'test.docx',
          s: 'timeline-item-file'
        }
      ]
      for (const f of files) {
        const fp = path.resolve(`tests/e2e/fixtures/test-files/${f.n}`)
        await alicePage.locator('chat-view [data-testid$="__fileInput"]').setInputFiles(fp)
        const cap = `S ${f.n}`
        await alicePage.fill('chat-view textarea', cap)
        await alicePage.click('chat-view [data-testid$="__sendButton"]')
        await expect(alicePage.locator('chat-view .message-status-container span')).toHaveText('Sent', { timeout: 60000 })
        const row = bobPage.locator('timeline-row').filter({ hasText: f.n }).last()
        await expect(row).toBeVisible({ timeout: 60000 })
        await expect(row.locator(f.s).first()).toBeVisible({ timeout: 30000 })
      }
      await aliceContext.close()
      await bobContext.close()
    })

    test('video compression', async ({ page, loginCustomPage }) => {
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
      const vp = path.join(__dirname, 'fixtures', 'test-files', 'test.mp4')
      await page.setInputFiles('[data-testid$="__fileInput"]', vp)
      await expect(page.locator('chat-attachment-preview .x-small.text-muted')).toContainText('Ready to send', { timeout: 45000 })
      await page.locator('[data-testid$="sendButton"]').click()
      await expect(page.locator('timeline-row img').first()).toBeVisible({ timeout: 15000 })
    })

    test('custom video cover selection and removal', async ({ page, loginCustomPage }) => {
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

      const vp = path.join(__dirname, 'fixtures', 'test-files', 'test.mp4')
      await page.setInputFiles('[data-testid$="__fileInput"]', vp)
      await expect(page.locator('chat-attachment-preview .x-small.text-muted')).toContainText('Ready to send', { timeout: 45000 })

      // Verify the Change Cover button exists
      const changeCoverBtn = page.locator('[data-testid$="__btn-change-cover"]')
      await expect(changeCoverBtn).toBeVisible()
      await expect(changeCoverBtn).toHaveText('Change Cover')

      // Programmatically input a custom cover image file
      const customCoverPath = path.resolve('tests/e2e/fixtures/test-files/test.png')
      await page.setInputFiles('[data-testid$="__cover-file-input"]', customCoverPath)

      // Verify custom cover application
      await expect(page.locator('chat-attachment-preview .x-small.text-muted')).toContainText('Custom cover applied', { timeout: 15000 })
      await expect(changeCoverBtn).toHaveText('Remove Custom Cover')

      // Click to remove custom cover
      await changeCoverBtn.click()

      // Should revert back to "Ready to send" or standard auto-thumbnail status
      await expect(page.locator('chat-attachment-preview .x-small.text-muted')).toContainText('Ready to send', { timeout: 15000 })
      await expect(changeCoverBtn).toHaveText('Change Cover')
    })

    test('audio uploads generate interactive SVG waveforms', async ({ page, loginCustomPage }) => {
      test.slow()
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
      const ap = path.resolve('tests/e2e/fixtures/test-files/test.mp3')
      await page.setInputFiles('[data-testid$="__fileInput"]', ap)
      await expect(page.locator('chat-attachment-preview .x-small.text-muted')).toContainText('Ready to send', { timeout: 45000 })
      await page.locator('[data-testid$="sendButton"]').click()

      // Wait for the message status to be 'Sent'
      await expect(page.locator('.message-status-container span').last()).toHaveText('Sent', { timeout: 60000 })

      // Verify that timeline-item-voice is rendered
      const voicePlayer = page.locator('timeline-item-voice')
      await expect(voicePlayer).toBeVisible({ timeout: 15000 })

      // Verify that the custom waveform player is visible (instead of standard <audio controls>)
      await expect(voicePlayer.locator('.waveform-player')).toBeVisible({ timeout: 15000 })

      // verify that the waveform contains svg elements for background and progress
      await expect(voicePlayer.locator('.waveform-container svg')).toHaveCount(2, { timeout: 15000 })
    })
  })

  test.describe('Viewers and Lists', () => {
    test.beforeEach(async ({ page, loginApp }) => {
      await loginApp('alice', 'Password123!', 'VaultPassword123!')
      await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
    })

    test('carousel and grid sync', async ({ page }) => {
      const ip = path.resolve('tests/e2e/fixtures/test-files/test.png')
      for (let i = 0; i < 2; i++) {
        await page.setInputFiles('[data-testid$="__fileInput"]', ip)
        await page.click('[data-testid$="__sendButton"]')
        await expect(page.locator('.message-status-container span').last()).toHaveText('Sent', { timeout: 20000 })
      }
      await page.locator('[data-testid="nav-sidebar-0__btnPictures"]').click()
      const cards = page.locator('media-grid-card')
      await cards.first().click()
      await page.click('.carousel-control-next')
      await expect(cards.nth(1).locator('.card')).toHaveClass(/is-active-card/)
    })

    test('carousel handles out-of-order type/id state transitions safely', async ({ page }) => {
      const ip = path.resolve('tests/e2e/fixtures/test-files/test.png')
      await page.setInputFiles('[data-testid$="__fileInput"]', ip)
      await page.click('[data-testid$="__sendButton"]')
      await expect(page.locator('.message-status-container span').last()).toHaveText('Sent', { timeout: 20000 })

      await page.locator('[data-testid="nav-sidebar-0__btnPictures"]').click()

      const cards = page.locator('media-grid-card')
      await expect(cards.first()).toBeVisible()
      await cards.first().click()

      await page.locator('[data-testid="nav-sidebar-0__btnChats"]').click()

      const chatImg = page.locator('timeline-item-media img').first()
      await expect(chatImg).toBeVisible()
      await chatImg.click()

      const activeCarouselImg = page.locator('image-viewer .carousel-item.active img')
      await expect(activeCarouselImg).toBeVisible({ timeout: 10000 })
      await expect(activeCarouselImg).toHaveAttribute('src', /^blob:/)
    })

    test('jump to chat', async ({ page }) => {
      const ip = path.resolve('tests/e2e/fixtures/test-files/test.png')
      await page.setInputFiles('[data-testid$="__fileInput"]', ip)
      await page.click('[data-testid$="__sendButton"]')
      const img = page.locator('timeline-item-media img').first()
      await expect(img).toBeVisible({ timeout: 15000 })
      await img.click()
      await page.click('image-viewer jump-to-chat button')
      await expect(page.locator('chat-view')).toBeVisible()
    })

    test('media preview hover overlay and max-width', async ({ page }) => {
      const ip = path.resolve('tests/e2e/fixtures/test-files/test.png')
      await page.setInputFiles('[data-testid$="__fileInput"]', ip)
      await page.click('[data-testid$="__sendButton"]')

      const img = page.locator('timeline-item-media img').first()
      await expect(img).toBeVisible({ timeout: 30000 })

      const container = page.locator('.media-preview-container').first()
      const maxWidthValue = await container.evaluate(el => window.getComputedStyle(el).maxWidth)
      expect(maxWidthValue).toBe('400px')

      const overlay = container.locator('.media-hover-overlay')
      await expect(overlay).toBeAttached()

      await container.hover()
      await page.waitForTimeout(500)

      await expect(overlay).toBeVisible()
      await expect(overlay.locator('i.bi-zoom-in')).toBeVisible()
    })

    test('aggregate documents and links', async ({ page }) => {
      const dp = path.resolve('tests/e2e/fixtures/test-files/test.txt')
      await page.setInputFiles('[data-testid$="__fileInput"]', dp)
      await page.click('[data-testid$="__sendButton"]')
      await expect(page.locator('.message-status-container span').last()).toHaveText('Sent', { timeout: 30000 })
      await page.locator('[data-testid="nav-sidebar-0__btnDocuments"]').click()
      await expect(page.locator('[data-testid$="__document-list-group"] .list-group-item').filter({ hasText: 'test.txt' })).toBeVisible()

      await page.route('**/api/link-extraction*', async r => {
        await r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            title: 'PB',
            url: 'https://g.com'
          })
        })
      })
      await page.locator('[data-testid="nav-sidebar-0__btnChats"]').click()
      await page.fill('textarea', 'https://g.com ')
      // Wait for debounced link-extraction to run and generate the preview
      await page.waitForTimeout(1000)
      await page.click('[data-testid$="__sendButton"]')
      await page.locator('[data-testid="nav-sidebar-0__btnLinks"]').click()
      await expect(page.locator('[data-testid$="__link-list-group"] .list-group-item')).toContainText('PB')
    })
  })

  test.describe('Media Manager', () => {
    test('takeover and playback', async ({ page, loginCustomPage }) => {
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
      await page.locator('[data-testid$="search-result-bob"]').click()
      await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
      const ap = path.resolve('tests/e2e/fixtures/test-files/test.mp3')
      await page.setInputFiles('[data-testid$="__fileInput"]', ap)
      await page.click('[data-testid$="__sendButton"]')

      // Wait for the message status to be 'Sent'
      await expect(page.locator('.message-status-container span').last()).toHaveText('Sent', { timeout: 60000 })

      await page.locator('[data-testid="nav-sidebar-0__btnMusic"]').click()
      await page.locator('music-list .app-list-item').first().click()
      await page.waitForTimeout(1000)
      await page.locator('audio-player-view .play-pause-btn').click()
      await expect(page.locator('audio-player-view .play-pause-btn i')).toHaveClass(/bi-pause-fill/, { timeout: 15000 })
    })
  })
})
