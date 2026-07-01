import { test, expect } from './fixtures/base-test.js'
import path from 'path'

test.describe('Media Manager Sidebar', () => {
  test('should handle media playback and takeover via sidebar manager', async ({ page, loginCustomPage }) => {
    console.log('Logging in...')
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')

    // 1. Verify Media Manager button exists in sidebar
    const mediaBtn = page.locator("button[title='Now Playing']")
    await expect(mediaBtn).toBeVisible()

    // 2. Upload an audio file to a chat to have something to play
    console.log('Creating a chat and uploading audio...')
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')

    const audioPath = path.resolve('tests/e2e/fixtures/test-files/test.mp3')
    await page.locator('chat-view chat-input-text input[type="file"]').setInputFiles(audioPath)
    await page.locator('chat-view [data-testid$="__sendButton"]').click()

    // Wait for upload and sent status
    await expect(page.locator('chat-view .message-status-container')).toBeVisible({ timeout: 20000 })

    // 3. Navigate to Music view to find the audio
    console.log('Navigating to Music view...')
    await page.click('button[title="Music"]')

    const musicItem = page.locator('music-list .list-group-item').first()
    await expect(musicItem).toBeVisible()
    await musicItem.click()

    // 4. Play from audio-player-view (Takeover)
    console.log('Playing from local view...')
    // Wait for the detail view to actually load the audio player
    await page.waitForTimeout(2000)
    const bigPlayBtn = page.locator('button:has(i.bi-play-fill)').last()
    await expect(bigPlayBtn).toBeVisible({ timeout: 10000 })
    await bigPlayBtn.click()

    // 5. Verify Sidebar Manager updates (Takeover check)
    // The icon should change to pause
    await expect(mediaBtn.locator('i.bi-pause-fill')).toBeVisible({ timeout: 10000 })

    // 6. Open Sidebar Dropdown and verify content
    console.log('Opening sidebar dropdown...')
    await mediaBtn.click()
    // Wait for the dropdown to be present in the DOM
    const dropdown = page.locator('.dropdown-menu')

    // 7. Test controls in dropdown
    console.log('Testing dropdown controls...')
    const dropdownToggleBtn = page.locator('button i.bi-pause-circle-fill').last()
    await expect(dropdownToggleBtn).toBeVisible({ timeout: 10000 })
    await dropdownToggleBtn.click()

    // Should pause
    await expect(mediaBtn.locator('i.bi-play-fill')).toBeVisible({ timeout: 10000 })
    await expect(bigPlayBtn.locator('i.bi-play-fill')).toBeVisible({ timeout: 10000 })

    console.log('Test completed successfully!')
  })
})
