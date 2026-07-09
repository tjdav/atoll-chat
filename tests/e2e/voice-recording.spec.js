import { test, expect } from './fixtures/base-test.js'

test.describe('Voice Recording', () => {
  test.beforeEach(async ({ page, loginApp }) => {
    test.slow()
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Create a room first to have an active chat
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username or email..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')

    // Wait for sync
    await page.waitForFunction(() => window.$bus && !window.$state.isCatchingUp)
  })

  test('should record and send a voice message', async ({ page }) => {
    // Click mic button to start recording mode
    await page.click('button[title="Voice message"]')

    // Check if recorder is visible
    await expect(page.locator('chat-voice-recorder')).toBeVisible()

    // Wait a bit for some recording duration
    await page.waitForTimeout(2000)

    // Click send button in recorder
    await page.click('chat-voice-recorder button.btn-primary')

    // Recorder should disappear
    await expect(page.locator('chat-voice-recorder')).not.toBeVisible()

    // Verify a message appeared in the timeline
    // The message should be an audio message rendering the custom interactive waveform
    await expect(page.locator('message-timeline .timeline-row-container .waveform-player').last()).toBeVisible({ timeout: 15000 })
  })
})
