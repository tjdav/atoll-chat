import { test, expect } from './fixtures/base-test.js'
import fs from 'fs'
import path from 'path'

test.use({
  video: 'on'
})

test.describe('Verify Network Resiliency UI', () => {
  test('should record video and capture screenshot of offline banner', async ({ page, loginApp }, testInfo) => {
    test.slow()

    // Ensure directory exists
    fs.mkdirSync('/home/jules/verification/videos', { recursive: true })
    fs.mkdirSync('/home/jules/verification/screenshots', { recursive: true })

    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Create a room
    await page.locator('[data-testid$="btnCreateRoom"]').click()
    await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid$="btnCreate"]').click()

    await expect(page.locator('chat-view')).toBeVisible({ timeout: 15000 })

    // Send warmup message to load dynamic timeline components
    const textarea = page.locator('textarea[placeholder="Type a message..."]')
    await textarea.fill('Warmup online message')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1000)

    // Go offline
    await page.context().setOffline(true)
    await page.waitForTimeout(1000)

    // Verify offline banner is visible
    const banner = page.locator('.offline-banner')
    await expect(banner).toBeVisible()

    // Send message offline
    await textarea.fill('Testing offline queue!')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1000)

    // Take verification screenshot of offline banner + pending message
    await page.screenshot({ path: '/home/jules/verification/screenshots/verification.png' })
    await page.waitForTimeout(1000)

    // Go online
    await page.context().setOffline(false)
    await page.waitForTimeout(2500) // Wait for flush to complete

    // Verify banner is hidden and message is sent
    await expect(banner).toBeHidden()

    // Wait for the video to be saved and copy it
    await page.context().close()
    const video = await page.video()
    if (video) {
      const videoPath = await video.path()
      if (fs.existsSync(videoPath)) {
        fs.copyFileSync(videoPath, '/home/jules/verification/videos/verification.webm')
        console.log('Video copied to /home/jules/verification/videos/verification.webm')
      }
    }
  })
})
