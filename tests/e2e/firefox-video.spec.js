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

    await page.getByTestId('btnCreateRoom').click()
    await page.locator('create-room-modal').getByTestId('searchInput').fill('bob')
    await page.getByTestId('search-result-bob').click()
    await page.getByTestId('btnCreate').click()

    const videoPath = path.join(TEST_FILES_DIR, 'test.mp4')
    await page.getByTestId('fileInput').setInputFiles(videoPath)

    // Verify UI status reaches Ready to send (either converted or original format fallback)
    await expect(page.locator('atoll-chat-attachment-preview .atoll-chat-attachment-preview-status')).toContainText('Ready to send', { timeout: 30000 })

    await page.fill('atoll-chat-view textarea', 'Firefox video test')
    await page.getByTestId('sendButton').click()

    await expect(page.getByTestId('status-text').last()).toHaveText('Sent', { timeout: 30000 })
    await expect(page.locator('atoll-chat-timeline-row').last()).toBeVisible({ timeout: 30000 })
  })

})
