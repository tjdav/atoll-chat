import { test, expect } from './fixtures/base-test.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_FILES_DIR = path.join(__dirname, 'fixtures', 'test-files')

test.describe('Non-Universal Media Format Conversion E2E Tests', () => {

  test('converts non-universal video (.mkv) to universal MP4 for web playback', async ({ browser, loginCustomPage }) => {
    test.setTimeout(120000)

    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()

    await Promise.all([
      loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!'),
      loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
    ])

    // Establish DM channel between Alice and Bob
    await alicePage.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await alicePage.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await alicePage.locator('[data-testid$="search-result-bob"]').click()
    await alicePage.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    const bobChat = bobPage.locator('chat-list chat-list-item').filter({ hasText: 'alice' }).first()
    await expect(bobChat).toBeVisible({ timeout: 30000 })
    await bobChat.click()

    // Attach non-universal video (test.mkv)
    const mkvPath = path.join(TEST_FILES_DIR, 'test.mkv')
    await alicePage.locator('atoll-chat-view [data-testid$="__fileInput"]').setInputFiles(mkvPath)

    // Verify UI status displays format conversion readiness
    await expect(alicePage.locator('chat-attachment-preview .x-small.text-muted')).toContainText('Ready to send', { timeout: 60000 })

    await alicePage.fill('atoll-chat-view textarea', 'Sending converted video test.mp4')
    await alicePage.click('atoll-chat-view [data-testid$="__sendButton"]')

    // Verify Alice's message status turns to Sent
    await expect(alicePage.locator('atoll-chat-view .atoll-chat-message-status-container [data-testid$="status-text"]')).toHaveText('Sent', { timeout: 60000 })

    // Verify Bob receives converted video message ending in .mp4
    const bobMessageRow = bobPage.locator('atoll-chat-timeline-row').filter({ hasText: 'test.mp4' }).last()
    await expect(bobMessageRow).toBeVisible({ timeout: 60000 })

    await aliceContext.close()
    await bobContext.close()
  })

  test('converts non-universal image (.tiff) to universal WebP format', async ({ page, loginCustomPage }) => {
    test.setTimeout(120000)

    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
    await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    const tiffPath = path.join(TEST_FILES_DIR, 'test.tiff')
    await page.locator('atoll-chat-view [data-testid$="__fileInput"]').setInputFiles(tiffPath)

    await expect(page.locator('chat-attachment-preview .x-small.text-muted')).toContainText('Ready to send', { timeout: 60000 })

    await page.fill('atoll-chat-view textarea', 'Sending converted image test.webp')
    await page.click('atoll-chat-view [data-testid$="__sendButton"]')

    await expect(page.locator('atoll-chat-view .atoll-chat-message-status-container [data-testid$="status-text"]')).toHaveText('Sent', { timeout: 60000 })

    // Verify converted .webp image renders in timeline
    const sentImageRow = page.locator('atoll-chat-timeline-row').filter({ hasText: 'test.webp' }).last()
    await expect(sentImageRow).toBeVisible({ timeout: 60000 })
  })

  test('converts non-universal audio (.wav) to universal MP4/AAC format', async ({ page, loginCustomPage }) => {
    test.setTimeout(120000)

    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
    await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    const wavPath = path.join(TEST_FILES_DIR, 'test.wav')
    await page.locator('atoll-chat-view [data-testid$="__fileInput"]').setInputFiles(wavPath)

    await expect(page.locator('chat-attachment-preview .x-small.text-muted')).toContainText('Ready to send', { timeout: 60000 })

    await page.fill('atoll-chat-view textarea', 'Sending converted audio test.m4a')
    await page.click('atoll-chat-view [data-testid$="__sendButton"]')

    await expect(page.locator('atoll-chat-view .atoll-chat-message-status-container [data-testid$="status-text"]')).toHaveText('Sent', { timeout: 60000 })

    // Verify converted .m4a audio message sends and renders timeline row
    const sentAudioRow = page.locator('atoll-chat-timeline-row').filter({ hasText: 'test.m4a' }).last()
    await expect(sentAudioRow).toBeVisible({ timeout: 60000 })
  })

})
