import { test, expect } from './fixtures/base-test.js'
import path from 'path'

test.describe('Video Player Robustness', () => {
  test('should handle video placeholder, manual play, and carousel resets', async ({ page, loginApp }) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // 1. Create a chat and send a video
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')
    await expect(page.locator('chat-view')).toBeVisible({ timeout: 10000 })

    const videoPath = path.join(process.cwd(), 'tests/e2e/fixtures/test-files/test.mp4')
    await page.setInputFiles('input[type="file"]', videoPath)
    await page.waitForTimeout(500)
    await page.click('[data-testid$="__sendButton"]')

    // Wait for the message to be sent
    await expect(page.locator('chat-view .message-status-container').last()).toBeVisible({ timeout: 20000 })
    await expect(page.locator('chat-view .message-status-container span').last()).toHaveText('Sent', { timeout: 20000 })

    // 2. Go to Videos view
    await page.click('button[title="Videos"]')
    await expect(page.locator('video-list')).toBeVisible()

    const cards = page.locator('media-grid-card')
    await expect(cards).toHaveCount(1, { timeout: 15000 })

    // 3. Select the video
    await cards.first().click()
    await expect(page.locator('video-player-view')).toBeVisible()

    // 4. Verify "Click to Play" placeholder is visible
    const activeItem = page.locator('video-player-view .carousel-item.active')
    const placeholder = activeItem.locator('.video-placeholder')
    await expect(placeholder).toBeVisible()
    await expect(placeholder.locator('button')).toBeVisible()
    await expect(placeholder).toContainText('Click to Play')

    // 5. Click Play and verify loading state (spinner) then video element
    await placeholder.locator('button').click()

    // Wait for either the video container to be visible OR the error display (since headless might fail playback)
    await page.waitForFunction(() => {
      const active = document.querySelector('video-player-view .carousel-item.active')
      if (!active) {
        return false
      }
      const container = active.querySelector('.video-container')
      const error = active.querySelector('.video-error')
      return (container && !container.classList.contains('d-none')) ||
               (error && !error.classList.contains('d-none'))
    }, { timeout: 15000 })

    const videoContainer = activeItem.locator('.video-container')
    const errorDisplay = activeItem.locator('.video-error')

    if (await videoContainer.isVisible()) {
      const videoEl = videoContainer.locator('video')
      await expect(videoEl).toBeAttached()
      await expect(videoEl).toHaveAttribute('controls', '')
    } else {
      console.log('Video playback failed in headless environment, verifying error display')
      await expect(errorDisplay).toBeVisible()
      await expect(errorDisplay.locator('.error-text')).not.toBeEmpty()
    }

    // 6. Test "carousel slide" reset by uploading another video
    await page.click('button[title="Chats"]')
    await page.setInputFiles('input[type="file"]', videoPath)
    await page.waitForTimeout(500)
    await page.click('[data-testid$="__sendButton"]')
    await expect(page.locator('chat-view .message-status-container').last()).toBeVisible({ timeout: 20000 })
    await expect(page.locator('chat-view .message-status-container span').last()).toHaveText('Sent', { timeout: 20000 })

    await page.click('button[title="Videos"]')
    await expect(cards).toHaveCount(2, { timeout: 15000 })

    // Select second (the one we didn't play yet)
    // In video-list, newest are first. The one we just sent is cards.first()
    await cards.first().click()
    // It should show placeholder because currentMedia was nullified for the new selection
    await expect(page.locator('video-player-view .carousel-item.active .video-placeholder')).toBeVisible()

    // Play it
    await page.locator('video-player-view .carousel-item.active .btn-big-play').click()

    await page.waitForFunction(() => {
      const active = document.querySelector('video-player-view .carousel-item.active')
      if (!active) {
        return false
      }
      const container = active.querySelector('.video-container')
      const error = active.querySelector('.video-error')
      return (container && !container.classList.contains('d-none')) ||
               (error && !error.classList.contains('d-none'))
    }, { timeout: 15000 })

    // Slide to next video
    await page.click('video-player-view .carousel-control-next')
    await page.waitForTimeout(1000)

    // The now active item should show the placeholder, NOT the video
    await expect(page.locator('video-player-view .carousel-item.active .video-placeholder')).toBeVisible()
    await expect(page.locator('video-player-view .carousel-item.active .video-container')).toBeHidden()
    await expect(page.locator('video-player-view .carousel-item.active .video-error')).toBeHidden()
  })
})
