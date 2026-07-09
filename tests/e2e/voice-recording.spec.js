import { test, expect } from '@playwright/test'

test.describe('Voice Recording', () => {
  test.beforeEach(async ({ page }) => {
    // Standard login flow
    await page.goto('/')
    await page.fill('input[type="text"]', 'alice')
    await page.fill('input[type="password"]', 'Password123!')
    await page.click('button[type="submit"]')

    await page.fill('input[placeholder="Enter Vault Password"]', 'VaultPassword123!')
    await page.click('button:has-text("Unlock Vault")')

    // Wait for sync
    await page.waitForFunction(() => window.$bus && !window.$state.isCatchingUp)

    // Select a chat
    await page.click('.app-list-item')
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
    // The message should be an audio message
    await expect(page.locator('message-timeline .timeline-row-container audio').last()).toBeVisible({ timeout: 15000 })
  })
})
