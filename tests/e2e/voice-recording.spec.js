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

  test('should record and send a voice message cleanly without conversion errors', async ({ page }) => {
    // Track toast messages to verify no conversion error toast appears
    const toasts = []
    page.on('console', msg => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        toasts.push(msg.text())
      }
    })

    // Click mic button to start recording mode
    await page.locator('[data-testid="atoll-chat-input-text-0__btn-mic-toggle"]').click()

    // Check if recorder is visible
    await expect(page.locator('atoll-chat-voice-recorder')).toBeVisible()

    // Wait for visualizer canvas to render and scale properly
    await page.waitForTimeout(1000)

    // Wait a bit for some recording duration
    await page.waitForTimeout(2000)

    // Click send button in recorder
    await page.locator('[data-testid="atoll-chat-voice-recorder-0__sendVoiceButton"]').click()

    // Recorder should disappear
    await expect(page.locator('atoll-chat-voice-recorder')).not.toBeVisible()

    // Crucial assertion: Verify NO toast with message "Cannot send unconverted media format" appears
    await expect(page.locator('.toast, [data-testid="toast-container"]').filter({ hasText: 'Cannot send unconverted media format' })).toHaveCount(0)

    // Verify timeline renders atoll-chat-timeline-item-voice containing the dual SVG waveform layers
    const voiceItem = page.locator('atoll-chat-timeline-item-voice').last()
    await expect(voiceItem).toBeVisible({ timeout: 30000 })
    await expect(voiceItem.locator('.atoll-chat-waveform-player')).toBeVisible({ timeout: 30000 })
    await expect(voiceItem.locator('.waveform-container svg')).toHaveCount(2, { timeout: 15000 })
  })

  test('should toggle playback on recorded voice note waveform player', async ({ page }) => {
    // Record and send voice note first
    await page.locator('[data-testid="atoll-chat-input-text-0__btn-mic-toggle"]').click()
    await expect(page.locator('atoll-chat-voice-recorder')).toBeVisible()
    await page.waitForTimeout(1000)
    await page.waitForTimeout(2000)
    await page.locator('[data-testid="atoll-chat-voice-recorder-0__sendVoiceButton"]').click()

    const voiceItem = page.locator('atoll-chat-timeline-item-voice').last()
    await expect(voiceItem.locator('.atoll-chat-waveform-player')).toBeVisible({ timeout: 30000 })

    const playBtn = voiceItem.locator('.play-pause-btn')
    await expect(playBtn).toBeVisible()

    // Initial state: play icon
    await expect(playBtn.locator('atoll-icon')).toHaveAttribute('name', 'play')

    // Click play
    await playBtn.click()

    // Transition state: pause icon
    await expect(playBtn.locator('atoll-icon')).toHaveAttribute('name', 'pause', { timeout: 10000 })
  })

  test('should send voice note while preserving queued draft text in composer', async ({ page }) => {
    const draftText = 'Draft message that should remain intact'

    // Stage text in composer textarea
    const composerTextarea = page.locator('atoll-chat-view textarea')
    await composerTextarea.fill(draftText)
    await expect(composerTextarea).toHaveValue(draftText)

    // Click mic button to start recording mode
    await page.locator('[data-testid="atoll-chat-input-text-0__btn-mic-toggle"]').click()
    await expect(page.locator('atoll-chat-voice-recorder')).toBeVisible()
    await page.waitForTimeout(1000)
    await page.waitForTimeout(2000)

    // Send voice note from recorder
    await page.locator('[data-testid="atoll-chat-voice-recorder-0__sendVoiceButton"]').click()
    await expect(page.locator('atoll-chat-voice-recorder')).not.toBeVisible()

    // Verify voice note is dispatched to timeline
    await expect(page.locator('atoll-chat-timeline-item-voice').last()).toBeVisible({ timeout: 30000 })

    // Verify draft text in composer remains intact
    await expect(composerTextarea).toHaveValue(draftText)
  })
})
