import { test, expect } from '@playwright/test'

test.describe('Secure Calls', () => {
  test.describe.configure({ mode: 'serial' })

  let aliceContext
  let bobContext
  let alicePage
  let bobPage

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(90000)
    aliceContext = await browser.newContext({
      permissions: ['camera', 'microphone']
    })
    bobContext = await browser.newContext({
      permissions: ['camera', 'microphone']
    })

    alicePage = await aliceContext.newPage()
    bobPage = await bobContext.newPage()

    // Login Alice
    await alicePage.goto('/')
    await alicePage.locator('#atoll-login__username-0').fill('alice')
    await alicePage.locator('#atoll-login__password-0').fill('password123')
    await alicePage.locator('#atoll-login__submitButton-0').click()
    await expect(alicePage.locator('#atoll-app-layout__layoutContainer-0')).toBeVisible({ timeout: 10000 })

    // Login Bob
    await bobPage.goto('/', { waitUntil: 'domcontentloaded' })
    await bobPage.locator('#atoll-login__username-0').fill('bob')
    await bobPage.locator('#atoll-login__password-0').fill('password123')
    await bobPage.locator('#atoll-login__submitButton-0').click()
    await expect(bobPage.locator('#atoll-app-layout__layoutContainer-0')).toBeVisible({ timeout: 10000 })

    // Setup room
    await alicePage.locator('#atoll-chat-list__openNewRoomModalBtn-0').click()
    const roomNameInput = alicePage.locator('#atoll-chat-list__roomNameInput-0')
    if (!await roomNameInput.isVisible()) {
      await alicePage.evaluate(() => {
        const modal = document.querySelector('[id^="atoll-chat-list__newRoomModal"]')
        if (modal && window.imports && window.imports.bootstrap) window.imports.bootstrap.Modal.getOrCreateInstance(modal).show()
        else if (modal && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(modal).show()
      })
      await expect(roomNameInput).toBeVisible({ timeout: 5000 })
    }
    await roomNameInput.fill('Video Call Room')
    await alicePage.locator('#atoll-chat-list__createRoomBtn-0').click()
    await expect(alicePage.locator('.room-item', { hasText: 'Video Call Room' })).toBeVisible({ timeout: 15000 })
    await alicePage.waitForTimeout(1000)
    await alicePage.locator('.room-item', { hasText: 'Video Call Room' }).click()

    // Invite Bob
    await alicePage.locator('#atoll-chat-window__openInviteModalBtn-0').click()
    const inviteInput = alicePage.locator('#atoll-chat-window__inviteUserIdInput-0')
    if (!await inviteInput.isVisible()) {
      await alicePage.evaluate(() => {
        const modal = document.querySelector('[id^="atoll-chat-window__inviteModal"]')
        if (modal && window.imports && window.imports.bootstrap) window.imports.bootstrap.Modal.getOrCreateInstance(modal).show()
        else if (modal && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(modal).show()
      })
      await expect(inviteInput).toBeVisible({ timeout: 5000 })
    }
    await inviteInput.fill('@bob:localhost')
    await alicePage.locator('#atoll-chat-window__sendInviteBtn-0').click()

    // Bob accepts
    await expect(bobPage.locator('.room-item', { hasText: 'Video Call Room' })).toBeVisible({ timeout: 15000 })
    await bobPage.waitForTimeout(1000)
    await bobPage.locator('.room-item', { hasText: 'Video Call Room' }).click()
    await bobPage.waitForTimeout(1000)
    const joinButton = bobPage.locator('#atoll-chat-window__joinRoomBtn-0')
    if (await joinButton.isVisible()) {
      await joinButton.click()
    }
  })

  test.afterAll(async () => {
    await aliceContext.close()
    await bobContext.close()
  })

  test('Ringing State', async () => {
    // User A clicks the video call button
    await alicePage.locator('#atoll-chat-window__startVideoCallBtn-0').click()

    // Verify User B sees the incoming call modal/toast
    const incomingCallModal = bobPage.locator('#atoll-app-layout__incomingCallModal-0')
    await expect(incomingCallModal).toBeVisible({ timeout: 15000 })
    await expect(incomingCallModal).toContainText('Video Call Room')
  })

  test('Stream Connection', async () => {
    // User B accepts
    const acceptButton = bobPage.locator('#atoll-app-layout__acceptCallBtn-0')
    await acceptButton.click()

    // Verify the <atoll-video-call> modal opens for both users
    await expect(alicePage.locator('#atoll-video-call__callModal-0')).toBeVisible({ timeout: 10000 })
    await expect(bobPage.locator('#atoll-video-call__callModal-0')).toBeVisible({ timeout: 10000 })
  })

  test('Media Tracks Assigned', async () => {
    // Wait a moment for WebRTC negotiation and track addition
    await alicePage.waitForTimeout(5000)

    // Check that the large remote <video> tag and small local <video> tag both have a srcObject assigned
    const checkVideoTracks = async (page) => {
      return page.evaluate(() => {
        // Find any element whose ID starts with the generated prefix for the video elements
        const localVideo = document.querySelector('video[id^="atoll-video-call__localVideo"]')
        const remoteVideo = document.querySelector('video[id^="atoll-video-call__remoteVideo"]')
        return {
          localHasSrc: localVideo && localVideo.srcObject !== null,
          remoteHasSrc: remoteVideo && remoteVideo.srcObject !== null
        }
      })
    }

    // Since we're using a fake camera in CI it might take a bit longer or fail to assign
    // Wait until they are both truthy using expect.poll
    await expect.poll(async () => {
      const tracks = await checkVideoTracks(alicePage)
      return tracks.localHasSrc && tracks.remoteHasSrc
    }, { timeout: 15000 }).toBeTruthy()

    await expect.poll(async () => {
      const tracks = await checkVideoTracks(bobPage)
      return tracks.localHasSrc && tracks.remoteHasSrc
    }, { timeout: 15000 }).toBeTruthy()
  })

  test('Hangup and Cleanup', async () => {
    // User A clicks "End Call"
    const endCallButton = alicePage.locator('#atoll-video-call__endCallBtn-0')
    await endCallButton.click()

    // Verify the modal closes for both users
    await expect(alicePage.locator('#atoll-video-call__callModal-0')).toBeHidden({ timeout: 5000 })
    await expect(bobPage.locator('#atoll-video-call__callModal-0')).toBeHidden({ timeout: 5000 })

    // Check that the camera tracks were successfully stopped (srcObject cleared)
    const isLocalVideoStopped = await alicePage.evaluate(() => {
      const videos = document.querySelectorAll('video')
      for (const video of videos) {
        if (video.srcObject && video.srcObject.active) {
          return false
        }
      }
      return true
    })

    expect(isLocalVideoStopped).toBeTruthy()
  })
})
