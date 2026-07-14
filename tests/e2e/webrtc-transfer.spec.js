import { test, expect } from './fixtures/base-test.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test.describe('P2P WebRTC Media Transfer Fallback', () => {
  test('transfer a media file over WebRTC when exceeding maxServerUploadSizeBytes', async ({ browser, loginCustomPage }) => {
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

    await alicePage.evaluate(() => {
      if (window.$config) {
        window.$config.maxServerUploadSizeBytes = 1
      }
    })

    const fp = path.resolve('tests/e2e/fixtures/test-files/test.png')
    await alicePage.locator('chat-view [data-testid$="__fileInput"]').setInputFiles(fp)

    await alicePage.fill('chat-view textarea', 'Sending heavy image P2P')
    await alicePage.click('chat-view [data-testid$="__sendButton"]')

    const bobTimelineRow = bobPage.locator('timeline-row').filter({ hasText: 'Sending heavy image P2P' }).last()
    await expect(bobTimelineRow).toBeVisible({ timeout: 60000 })

    const decryptedImg = bobTimelineRow.locator('timeline-item-media img').first()
    await expect(decryptedImg).toBeVisible({ timeout: 30000 })

    // Take screenshot of Bob's view with the decrypted image
    await bobPage.screenshot({ path: '/home/jules/verification/screenshots/verification.png' })

    const hasMediaUpload = await alicePage.evaluate(async () => {
      if (window.$state && window.$state.currentUser) {
        const pbUrl = window.$config?.pb_url || 'http://localhost:8090'
        const response = await fetch(`${pbUrl}/api/collections/media/records`, {
          headers: {
            'x-test-id': window.__playwright_test_id__
          }
        })
        if (response.ok) {
          const list = await response.json()
          return list.items.length > 0
        }
      }
      return false
    })

    expect(hasMediaUpload).toBe(false)

    await aliceContext.close()
    await bobContext.close()
  })
})
