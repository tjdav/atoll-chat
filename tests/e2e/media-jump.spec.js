import { test, expect } from './fixtures/base-test.js'
import path from 'path'

test.describe('Media Jump to Chat', () => {
  test('should allow jumping back to chat from image and video viewers', async ({ page, loginCustomPage }) => {
    // 1. Login Alice
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')

    // 2. Create chat with Bob
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    const bobResult = page.locator('.search-result-item').filter({ hasText: 'bob' })
    await expect(bobResult).toBeVisible()
    await bobResult.click()
    await page.click('button:has-text("Create Room")')
    await expect(page.locator('chat-view')).toBeVisible({ timeout: 10000 })

    // 3. Alice sends an image
    const imagePath = path.join(process.cwd(), 'tests/e2e/fixtures/test-files/test.png')
    await page.setInputFiles('[data-testid$="__imageInput"]', imagePath)
    await page.click('[data-testid$="__sendButton"]')

    // 4. Verify image in timeline and click to open viewer
    const imageMsg = page.locator('media-preview img').first()
    await expect(imageMsg).toBeVisible({ timeout: 15000 })
    await imageMsg.click()
    await expect(page.locator('image-viewer')).toBeVisible()

    // 5. Verify Jump to Chat in Image Viewer
    await expect(page.locator('image-viewer viewer-header')).toContainText('Image Details')
    await page.click('image-viewer jump-to-chat button')
    await expect(page.locator('chat-view')).toBeVisible()
    await expect(imageMsg).toBeVisible()

    // 6. Alice sends a video
    const videoPath = path.join(process.cwd(), 'tests/e2e/fixtures/test-files/test.mp4')
    await page.setInputFiles('[data-testid$="__videoInput"]', videoPath)
    await page.click('[data-testid$="__sendButton"]')

    // 7. Open video viewer
    const videoMsg = page.locator('media-preview video').first()
    await expect(videoMsg).toBeVisible({ timeout: 15000 })
    await videoMsg.click()
    await expect(page.locator('video-player-view')).toBeVisible()

    // 8. Verify Jump to Chat in Video Viewer
    await expect(page.locator('video-player-view viewer-header')).toContainText('Video Details')
    await page.click('video-player-view jump-to-chat button')
    await expect(page.locator('chat-view')).toBeVisible()
    await expect(videoMsg).toBeVisible()
  })
})
