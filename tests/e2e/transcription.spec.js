import { test, expect } from './fixtures/base-test.js'

test.describe('Voice Message Transcription E2E', () => {
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

  test('should transcribe a voice message successfully and show transcript', async ({ page }) => {
    // Click mic button to start recording mode
    await page.locator('[data-testid="atoll-chat-input-text-0__btn-mic-toggle"]').click()

    // Wait a bit for recording
    await page.locator('atoll-chat-voice-recorder').waitFor({ state: 'visible' })
    await page.waitForTimeout(2000)

    // Click send button in recorder
    await page.locator('[data-testid="atoll-chat-voice-recorder-0__sendVoiceButton"]').click()

    // wait for message interactive waveform to appear in timeline
    const transcribeBtn = page.locator('[data-testid="btn-transcribe"]').last()
    await expect(transcribeBtn).toBeVisible({ timeout: 30000 })

    // Take initial screenshot
    await page.screenshot({ path: '/home/jules/verification/screenshots/initial.png' })

    // Click Transcribe button
    await transcribeBtn.click()

    // Expect progress to be visible
    await page.waitForTimeout(500)
    await page.screenshot({ path: '/home/jules/verification/screenshots/progress.png' })

    // Wait for the transcript card to appear
    const transcriptCard = page.locator('.transcription-card').last()
    await expect(transcriptCard).toBeVisible({ timeout: 30000 })

    // Take final screenshot
    await page.screenshot({ path: '/home/jules/verification/screenshots/verification.png' })

    // Expect correct non-empty transcript text
    const textEl = transcriptCard.locator('.transcription-text')
    await expect(textEl).not.toBeEmpty()
  })

  test('should not reset previously transcribed voice messages when transcribing a new one', async ({ page }) => {
    // 1. Send first voice message
    await page.locator('[data-testid$="__btn-mic-toggle"]').click()
    await page.locator('atoll-chat-voice-recorder').waitFor({ state: 'visible' })
    await page.waitForTimeout(2000)
    await page.locator('[data-testid$="__sendVoiceButton"]').click()

    // Wait for first Transcribe button to appear
    const firstTranscribeBtn = page.locator('[data-testid="btn-transcribe"]').first()
    await expect(firstTranscribeBtn).toBeVisible({ timeout: 30000 })

    // 2. Send second voice message
    await page.locator('[data-testid$="__btn-mic-toggle"]').click()
    await page.locator('atoll-chat-voice-recorder').waitFor({ state: 'visible' })
    await page.waitForTimeout(2000)
    await page.locator('[data-testid$="__sendVoiceButton"]').click()

    // Wait for second Transcribe button to appear (there should now be 2 transcribe buttons)
    const secondTranscribeBtn = page.locator('[data-testid="btn-transcribe"]').last()
    await expect(page.locator('[data-testid="btn-transcribe"]')).toHaveCount(2, { timeout: 30000 })

    // 3. Transcribe the first voice message
    await firstTranscribeBtn.click()

    // Wait for the first message's transcript card to appear
    const firstTranscriptCard = page.locator('.transcription-card').first()
    await expect(firstTranscriptCard).toBeVisible({ timeout: 30000 })
    const firstTranscriptText = await firstTranscriptCard.locator('.transcription-text').textContent()

    // 4. Transcribe the second voice message
    await secondTranscribeBtn.click()

    // Wait a brief moment for the second message transcription to be in progress or finish
    await page.waitForTimeout(2000)

    // 5. Verify the first transcript is still intact and not reset to a loading/progress view
    await expect(firstTranscriptCard).toBeVisible()
    await expect(firstTranscriptCard.locator('.transcription-text')).toHaveText(firstTranscriptText)
  })
})
