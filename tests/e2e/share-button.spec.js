import { test, expect } from './fixtures/base-test.js'
import path from 'path'

test.describe('Share Button', () => {
  test('should allow sharing an image to another room', async ({ page, loginCustomPage }) => {
    // 1. Login Alice
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')

    // 2. Create chat with Bob
    await page.click('button[title="Chats"]')
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    const bobResult = page.locator('.search-result-item').filter({ hasText: 'bob' })
    await expect(bobResult).toBeVisible()
    await bobResult.click()
    await page.click('button:has-text("Create Room")')
    await expect(page.locator('chat-view')).toBeVisible({ timeout: 10000 })

    // 3. Create chat with Charlie
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'char')
    const charlieResult = page.locator('.search-result-item').filter({ hasText: 'charlie' })
    await expect(charlieResult).toBeVisible()
    await charlieResult.click()
    await page.click('button:has-text("Create Room")')
    await expect(page.locator('chat-view')).toBeVisible({ timeout: 10000 })

    // 4. Send an image to Charlie
    const imagePath = path.join(process.cwd(), 'tests/e2e/fixtures/test-files/test.png')
    await page.locator('[data-testid$="__imageInput"]').setInputFiles(imagePath)
    await page.click('[data-testid$="__sendButton"]')

    // 5. Open image viewer
    const imageMsg = page.locator('media-preview img').first()
    await expect(imageMsg).toBeVisible({ timeout: 15000 })
    await imageMsg.click()
    await expect(page.locator('image-viewer')).toBeVisible()

    // 6. Click Share button
    const shareBtn = page.locator('share-button button').filter({ visible: true })
    await expect(shareBtn).toBeVisible()
    await shareBtn.click()

    // 7. Verify Share modal and select Bob
    const shareModal = page.locator('.modal.show').filter({ hasText: 'Share to...' })
    await expect(shareModal).toBeVisible()
    await shareModal.locator('label').filter({ hasText: 'bob' }).first().click()
    await shareModal.locator('button:has-text("Send")').click()

    // 8. Verify Toast
    await expect(page.locator('.toast.show')).toContainText('Shared with 1 room')

    // 9. Go to Bob's chat and verify shared image
    await page.click('button[title="Chats"]')
    await page.locator('chat-list-item').filter({ hasText: 'bob' }).click()
    await expect(page.locator('chat-view header')).toContainText('bob')
    await expect(page.locator('media-preview img').first()).toBeVisible({ timeout: 15000 })
  })

  test('should allow sharing a video to another room', async ({ page, loginCustomPage }) => {
    // 1. Login Alice
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')

    // 2. Create chat with Bob and Charlie (same as above)
    await page.click('button[title="Chats"]')
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.locator('.search-result-item').filter({ hasText: 'bob' }).click()
    await page.click('button:has-text("Create Room")')

    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'char')
    await page.locator('.search-result-item').filter({ hasText: 'charlie' }).click()
    await page.click('button:has-text("Create Room")')

    // 4. Send a video to Charlie
    const videoPath = path.join(process.cwd(), 'tests/e2e/fixtures/test-files/test.mp4')
    await page.locator('[data-testid$="__videoInput"]').setInputFiles(videoPath)
    await page.click('[data-testid$="__sendButton"]')

    // 5. Open video viewer
    const videoMsg = page.locator('media-preview video').first()
    await expect(videoMsg).toBeVisible({ timeout: 15000 })
    await videoMsg.click()
    await expect(page.locator('video-player-view')).toBeVisible()

    // 6. Click Share button
    const shareBtn = page.locator('share-button button').filter({ visible: true })
    await expect(shareBtn).toBeVisible()
    await shareBtn.click()

    // 7. Verify Share modal and select Bob
    const shareModal = page.locator('.modal.show').filter({ hasText: 'Share to...' })
    await expect(shareModal).toBeVisible()
    await shareModal.locator('label').filter({ hasText: 'bob' }).first().click()
    await shareModal.locator('button:has-text("Send")').click()

    // 8. Verify Toast
    await expect(page.locator('.toast.show')).toContainText('Shared with 1 room')

    // 9. Go to Bob's chat and verify shared video
    await page.click('button[title="Chats"]')
    await page.locator('chat-list-item').filter({ hasText: 'bob' }).click()
    await expect(page.locator('chat-view header')).toContainText('bob')
    await expect(page.locator('media-preview video').first()).toBeVisible({ timeout: 15000 })
  })
})
