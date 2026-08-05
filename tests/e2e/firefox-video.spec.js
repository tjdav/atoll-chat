import { test, expect } from './fixtures/base-test.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_FILES_DIR = path.join(__dirname, 'fixtures', 'test-files')

test.describe('Firefox Video Sharing & Conversion E2E Tests', () => {

  test('handles video sharing and conversion gracefully in Firefox', async ({ page, loginCustomPage }) => {
    test.setTimeout(60000)

    page.on('console', msg => console.log(`[FIREFOX CONSOLE ${msg.type()}]`, msg.text()))
    page.on('pageerror', err => console.log('[FIREFOX PAGE ERROR]', err.message))

    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')

    await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    const videoPath = path.join(TEST_FILES_DIR, 'test.mp4')
    await page.locator('chat-view [data-testid$="__fileInput"]').setInputFiles(videoPath)

    // Verify UI status reaches Ready to send (either converted or original format fallback)
    await expect(page.locator('chat-attachment-preview .x-small.text-muted')).toContainText('Ready to send', { timeout: 30000 })

    await page.fill('chat-view textarea', 'Firefox video test')
    await page.click('chat-view [data-testid$="__sendButton"]')

    await expect(page.locator('chat-view .message-status-container [data-testid$="status-text"]')).toHaveText('Sent', { timeout: 30000 })
    await expect(page.locator('timeline-row').last()).toBeVisible({ timeout: 30000 })
  })

})
