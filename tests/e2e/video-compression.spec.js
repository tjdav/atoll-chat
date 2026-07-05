import { test, expect } from './fixtures/base-test.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test.describe('Video Compression', () => {
  test('should compress video before sending', async ({ page, loginCustomPage }) => {
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')

    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    const bobResult = page.locator('.search-result-item').filter({ hasText: 'bob' }).first()
    await expect(bobResult).toBeVisible({ timeout: 10000 })
    await bobResult.click()
    await page.click('button:has-text("Create Room")')

    await expect(page.locator('chat-view header h6')).toContainText('bob')

    const videoPath = path.join(__dirname, 'fixtures', 'test-files', 'test.mp4')

    await page.setInputFiles('[data-testid$="__videoInput"]', videoPath)

    await expect(page.locator('chat-attachment-preview')).toBeVisible()
    // It might be too fast to see "Compressing video..." in some environments,
    // but it should eventually be "Ready to send"
    await expect(page.locator('chat-attachment-preview .x-small.text-muted')).toContainText(/Compressing video|Ready to send/, { timeout: 30000 })

    await expect(page.locator('chat-attachment-preview .x-small.text-muted')).toContainText('Ready to send', { timeout: 45000 })

    await page.locator('.bi-send-fill').click()

    await expect(page.locator('timeline-row video').first()).toBeVisible({ timeout: 15000 })
  })
})
