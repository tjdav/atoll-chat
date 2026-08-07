import { test, expect } from './fixtures/base-test.js'

test.describe('Voice Recording', () => {
  test.beforeEach(async ({ page, loginApp }) => {
    test.slow()
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Create a room first to have an active chat
    await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    // Wait for sync
    await page.waitForFunction(() => window.$bus && !window.$state.isCatchingUp)
  })

  test('should record and send a voice message', async ({ page }) => {
    // Click mic button to start recording mode
    await page.locator('[data-testid="atoll-chat-input-text-0__btn-mic-toggle"]').click()

    // Check if recorder is visible
    await expect(page.locator('chat-voice-recorder')).toBeVisible()

    // Wait a bit for some recording duration
    await page.waitForTimeout(2000)

    // Click send button in recorder
    await page.locator('[data-testid="chat-voice-recorder-0__sendVoiceButton"]').click()

    // Recorder should disappear
    await expect(page.locator('chat-voice-recorder')).not.toBeVisible()

    // verify message appeared in timeline with interactive waveform
    await expect(page.locator('atoll-chat-timeline .atoll-chat-timeline-row-container .waveform-player').last()).toBeVisible({ timeout: 30000 })
  })
})
