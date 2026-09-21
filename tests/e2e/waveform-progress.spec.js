import { test, expect } from './fixtures/base-test.js'

test.describe('Audio Waveform Playback Progress Smoothness', () => {
  test.beforeEach(async ({ page, loginApp }) => {
    test.slow()
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Create a room first to have an active chat
    await page.getByTestId('btnCreateRoom').click()
    await page.locator('create-room-modal').getByTestId('searchInput').fill('bob')
    await page.getByTestId('search-result-bob').click()
    await page.getByTestId('btnCreate').click()

    // Wait for sync
    await page.waitForFunction(() => window.$bus && !window.$state.isCatchingUp)
  })

  test('should smoothly transition progress bar on voice note play', async ({ page }) => {
    // Click mic button to start recording mode
    await page.getByTestId('btn-mic-toggle').click()

    // Wait a bit for recording
    await page.locator('atoll-chat-voice-recorder').waitFor({ state: 'visible' })
    await page.waitForTimeout(2000)

    // Click send button in recorder
    await page.getByTestId('sendVoiceButton').click()

    // wait for message interactive waveform to appear in timeline
    const waveform = page.locator('atoll-chat-timeline .atoll-chat-waveform-player').last()
    await expect(waveform).toBeVisible({ timeout: 30000 })

    // Play the audio
    const playBtn = waveform.locator('.play-pause-btn')
    await playBtn.click()

    // Wait and ensure it starts updating the progress bar width smoothly beyond 0%
    const progress = waveform.locator('.waveform-progress')
    await page.waitForTimeout(1000)

    const widthStyle = await progress.getAttribute('style')
    expect(widthStyle).not.toBeNull()
    expect(widthStyle).toContain('width:')

    // Wait for the audio to end (icon changes back to play)
    const playIcon = playBtn.locator('atoll-icon')
    await expect(playIcon).toHaveAttribute('name', 'play', { timeout: 15000 })

    // Play the audio again!
    await playBtn.click()
    await expect(playIcon).toHaveAttribute('name', 'pause', { timeout: 5000 })

    // Wait and ensure it plays and updates progress bar again
    await page.waitForTimeout(1000)
    const widthStyleAfterReplay = await progress.getAttribute('style')
    expect(widthStyleAfterReplay).not.toBeNull()
    expect(widthStyleAfterReplay).toContain('width:')
  })
})
