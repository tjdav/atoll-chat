import { test, expect } from '@playwright/test'

// CRITICAL: Configure Playwright to use fake media devices and auto-grant permissions.
// Without this, the test will hang waiting for a physical webcam or user prompt.
test.use({
  permissions: ['camera', 'microphone'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream'
    ]
  }
})

test.describe('WebRTC Video and Voice Call Flows', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(async () => {
      return new Promise((resolve) => {
        const request = window.indexedDB.deleteDatabase('atoll-user-preferences')
        request.onsuccess = resolve
        request.onerror = resolve
      })
    })
  })

  const loginAs = async (page, username) => {
    await page.goto('/')

    const loginForm = page.locator('.card').filter({ hasText: 'Login to Matrix' })
    await expect(loginForm).toBeVisible({ timeout: 10000 })

    await loginForm.getByPlaceholder('Homeserver URL').fill('http://localhost:6167')
    await loginForm.getByPlaceholder('Username').fill(username)
    await loginForm.getByPlaceholder('Password').fill('password123')

    const syncPromise = page.waitForResponse(response => response.url().includes('/_matrix/client/v3/sync') && response.status() === 200, { timeout: 15000 })
    await loginForm.getByRole('button', { name: 'Login' }).click()
    await syncPromise

    const sidebar = page.locator('[ref="atoll-app-layout__layoutContainer-0"]')
    await expect(sidebar).toBeVisible({ timeout: 10000 })
  }

  test('End-to-end Video Call between two users', async ({ page: pageA, browser }) => {
    // WebRTC signaling over Matrix takes time; give the test plenty of runway
    test.setTimeout(120000)

    // ==========================================
    // 1. User A (Alice): Setup Room and Invite
    // ==========================================
    await loginAs(pageA, 'alice')

    // Create room
    await pageA.locator('[ref="atoll-chat-list__openNewRoomModalBtn-0"]').click()
    const uniqueRoomName = 'Video Call Room ' + Date.now()
    await pageA.locator('input[id*="atoll-chat-list__roomNameInput"]').fill(uniqueRoomName)
    await pageA.getByRole('button', { name: 'Create' }).click()

    const roomItemA = pageA.locator('.room-item').filter({ hasText: uniqueRoomName })
    await expect(roomItemA).toBeVisible({ timeout: 15000 })
    await roomItemA.click()

    // Invite Bob
    await pageA.getByRole('button', { name: 'Invite' }).click()
    await pageA.locator('input[id*="atoll-chat-window__inviteUserIdInput"]').fill('@bob:localhost')
    await pageA.getByRole('button', { name: 'Send Invite' }).click()

    // ==========================================
    // 2. User B (Bob): Login and Join Room
    // ==========================================
    // Note: We must explicitly grant permissions to the new context as well
    const contextB = await browser.newContext({
      permissions: ['camera', 'microphone']
    })
    const pageB = await contextB.newPage()
    await loginAs(pageB, 'bob')

    const roomItemB = pageB.locator('.room-item').filter({ hasText: uniqueRoomName })
    await expect(roomItemB).toBeVisible({ timeout: 15000 })
    await roomItemB.click()

    const joinBtn = pageB.getByRole('button', { name: 'Join' })
    await expect(joinBtn).toBeVisible({ timeout: 15000 })
    await joinBtn.click()

    // Wait for the chat timeline to confirm Bob is fully in the room
    await expect(pageB.locator('[ref="atoll-chat-timeline__messagesContainer-0"]')).toBeVisible({ timeout: 15000 })

    // ==========================================
    // 3. Alice initiates Video Call
    // ==========================================
    // AST Splicing safe locator: find the button containing the video camera icon
    const startVideoBtnA = pageA.locator('button:has(.bi-camera-video)')
    await startVideoBtnA.click()

    // Alice's screen should show the full-screen video modal immediately (ringing state)
    const videoModalA = pageA.locator('.modal-fullscreen')
    await expect(videoModalA).toBeVisible({ timeout: 10000 })

    // ==========================================
    // 4. Bob receives and accepts the call
    // ==========================================
    // Wait for the incoming call toast/modal on Bob's side
    // Using title="Accept" based on atoll-app-layout.html template
    const acceptCallBtnB = pageB.locator('button[title="Accept"]')

    // Give Matrix time to sync the offer, retry loop since secondary contexts can be flaky
    await expect(async () => {
      // Re-click the room just in case sync dropped and room is unselected
      await roomItemB.click()
      await expect(acceptCallBtnB).toBeVisible({ timeout: 5000 })
    }).toPass({ timeout: 30000 })

    await acceptCallBtnB.click()

    // Bob's screen should transition to the full-screen video modal
    const videoModalB = pageB.locator('.modal-fullscreen')
    await expect(videoModalB).toBeVisible({ timeout: 10000 })

    // ==========================================
    // 5. Verify Video Streams & Hardware Controls
    // ==========================================
    // Ensure both remote and local `<video>` tags are mounted in the modal
    await expect(videoModalA.locator('video').first()).toBeVisible({ timeout: 15000 })
    await expect(videoModalB.locator('video').first()).toBeVisible({ timeout: 15000 })

    // Alice toggles Mute
    const toggleAudioBtnA = videoModalA.locator('button[title="Toggle Audio"]')
    await toggleAudioBtnA.click()
    // Verify the icon changed to the muted state
    await expect(toggleAudioBtnA.locator('.bi-mic-mute-fill')).toBeVisible({ timeout: 5000 })

    // Alice toggles Video off
    const toggleVideoBtnA = videoModalA.locator('button[title="Toggle Video"]')
    await toggleVideoBtnA.click()
    // Verify the icon changed to video-off state
    await expect(toggleVideoBtnA.locator('.bi-camera-video-off-fill')).toBeVisible({ timeout: 5000 })

    // ==========================================
    // 6. Bob ends the call
    // ==========================================
    const endCallBtnB = videoModalB.locator('button[title="End Call"]')
    await endCallBtnB.click()

    // Verify modals close for both users as the hangup syncs
    await expect(videoModalB).toBeHidden({ timeout: 10000 })
    // Alice waits for Matrix to deliver the hangup event
    await expect(videoModalA).toBeHidden({ timeout: 15000 })

    await contextB.close()
  })
})
