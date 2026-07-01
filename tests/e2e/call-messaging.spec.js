import { test, expect } from './fixtures/base-test.js'

test.describe.serial('Call Messaging', () => {
  let aliceContext, alicePage
  let bobContext, bobPage

  test.beforeEach(async ({ browser }) => {
    aliceContext = await browser.newContext()
    alicePage = await aliceContext.newPage()
    bobContext = await browser.newContext()
    bobPage = await bobContext.newPage()

    // Attach console listeners
    alicePage.on('console', msg => console.log(`[ALICE BROWSER] ${msg.type()}: ${msg.text()}`))
    bobPage.on('console', msg => console.log(`[BOB BROWSER] ${msg.type()}: ${msg.text()}`))
    alicePage.on('pageerror', err => console.log(`[ALICE ERROR] ${err.message}`))
    bobPage.on('pageerror', err => console.log(`[BOB ERROR] ${err.message}`))
  })

  test.afterEach(async () => {
    await aliceContext?.close()
    await bobContext?.close()
  })

  async function loginAndSetup (loginCustomPage) {
    console.log('Logging in Alice...')
    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')

    console.log('Logging in Bob...')
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
  }

  async function createRoom (callerPage, receiverPage, receiverName, callerName) {
    console.log(`${callerName} creating room with ${receiverName}...`)
    await callerPage.click('button[title="Create Room"]')
    await callerPage.fill('input[placeholder="Search by username..."]', receiverName)
    await callerPage.click(`.search-result-item:has-text("${receiverName}")`)
    await callerPage.click('button:has-text("Create Room")')

    await expect(callerPage.locator('chat-view header h6')).toContainText(receiverName)

    console.log(`${receiverName} selecting the chat...`)
    const receiverChatListCaller = receiverPage.locator('chat-list .list-group-item').filter({ hasText: callerName }).first()
    await expect(receiverChatListCaller).toBeVisible({ timeout: 30000 })
    await receiverChatListCaller.click()
    await expect(receiverPage.locator('chat-view header h6')).toContainText(callerName)
  }

  test('Audio Call between Alice and Bob', async ({ loginCustomPage }) => {
    await loginAndSetup(loginCustomPage)
    await createRoom(alicePage, bobPage, 'bob', 'alice')

    console.log('Alice initiating audio call...')
    await alicePage.click('button[title="Audio Call"]')

    // Bob sees incoming call
    console.log('Bob waiting for incoming call...')
    const bobIncomingView = bobPage.locator('call-overlay .incoming-view')
    await expect(bobIncomingView).toBeVisible({ timeout: 20000 })

    // Ensure caller info is hydrated (avoid "Unknown Caller" race)
    await expect(bobIncomingView.locator('h2')).not.toHaveText('Unknown Caller', { timeout: 10000 })

    // Bob accepts
    console.log('Bob accepting call...')
    await bobPage.click('call-overlay button[title="Accept Call"]')

    // Both should see active call view
    console.log('Verifying active call state for both...')
    await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })
    await expect(bobPage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })

    // Verify initial states for Audio Call
    // Alice: Audio ON, Video OFF
    const aliceAudioBtn = alicePage.locator('call-overlay .active-view button:has(.bi-mic-fill), call-overlay .active-view button:has(.bi-mic-mute-fill)')
    const aliceVideoBtn = alicePage.locator('call-overlay .active-view button:has(.bi-camera-video-fill), call-overlay .active-view button:has(.bi-camera-video-off-fill)')
    await expect(aliceAudioBtn).toHaveClass(/btn-light/)
    await expect(aliceVideoBtn).toHaveClass(/btn-danger/)

    // Bob: Audio ON, Video ON (Bob's accept always enables both currently in code)
    const bobAudioBtn = bobPage.locator('call-overlay .active-view button:has(.bi-mic-fill), call-overlay .active-view button:has(.bi-mic-mute-fill)')
    const bobVideoBtn = bobPage.locator('call-overlay .active-view button:has(.bi-camera-video-fill), call-overlay .active-view button:has(.bi-camera-video-off-fill)')
    await expect(bobAudioBtn).toHaveClass(/btn-light/)
    await expect(bobVideoBtn).toHaveClass(/btn-light/)

    // Assert media connection (remote video srcObject should be null for audio call as per current logic)
    // And placeholder should be visible
    await expect(alicePage.locator('video-grid [ref="video-grid-0__remotePlaceholder"]')).toBeVisible()
    await expect(bobPage.locator('video-grid [ref="video-grid-0__remotePlaceholder"]')).toBeVisible()
    expect(await alicePage.locator('video-grid video.remote-video').evaluate(el => el.srcObject === null)).toBe(true)
    expect(await bobPage.locator('video-grid video.remote-video').evaluate(el => el.srcObject === null)).toBe(true)

    // Toggle Mute (Alice)
    console.log('Alice toggling mute...')
    await alicePage.click('call-overlay .active-view button:has(.bi-mic-fill), call-overlay .active-view button:has(.bi-mic-mute-fill)')
    await expect(aliceAudioBtn).toHaveClass(/btn-danger/)
    await expect(aliceAudioBtn.locator('i')).toHaveClass(/bi-mic-mute-fill/)

    // End Call (Alice)
    console.log('Alice ending call...')
    await alicePage.click('call-overlay .active-view button:has(.bi-telephone-x-fill)')

    // Verify overlay is hidden for both
    console.log('Verifying call overlay is hidden...')
    await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
    await expect(bobPage.locator('call-overlay .modal')).not.toBeVisible()
  })

  test('Video Call between Alice and Bob', async ({ loginCustomPage }) => {
    await loginAndSetup(loginCustomPage)
    await createRoom(alicePage, bobPage, 'bob', 'alice')

    console.log('Alice initiating video call...')
    await alicePage.click('button[title="Video Call"]')

    // Bob sees incoming call
    console.log('Bob waiting for incoming call...')
    const bobIncomingView = bobPage.locator('call-overlay .incoming-view')
    await expect(bobIncomingView).toBeVisible({ timeout: 20000 })

    // Bob accepts
    console.log('Bob accepting call...')
    await bobPage.click('call-overlay button[title="Accept Call"]')

    // Both should see active call view
    console.log('Verifying active call state for both...')
    await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })
    await expect(bobPage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })

    // Verify initial states for Video Call
    const aliceAudioBtn = alicePage.locator('call-overlay .active-view button:has(.bi-mic-fill), call-overlay .active-view button:has(.bi-mic-mute-fill)')
    const aliceVideoBtn = alicePage.locator('call-overlay .active-view button:has(.bi-camera-video-fill), call-overlay .active-view button:has(.bi-camera-video-off-fill)')
    await expect(aliceAudioBtn).toHaveClass(/btn-light/)
    await expect(aliceVideoBtn).toHaveClass(/btn-light/)

    const bobAudioBtn = bobPage.locator('call-overlay .active-view button:has(.bi-mic-fill), call-overlay .active-view button:has(.bi-mic-mute-fill)')
    const bobVideoBtn = bobPage.locator('call-overlay .active-view button:has(.bi-camera-video-fill), call-overlay .active-view button:has(.bi-camera-video-off-fill)')
    await expect(bobAudioBtn).toHaveClass(/btn-light/)
    await expect(bobVideoBtn).toHaveClass(/btn-light/)

    // Assert media connection (remote video readyState 4 for video call)
    console.log('Verifying remote video stream readyState...')
    await expect(alicePage.locator('video-grid video.remote-video')).toHaveJSProperty('readyState', 4, { timeout: 20000 })
    await expect(bobPage.locator('video-grid video.remote-video')).toHaveJSProperty('readyState', 4, { timeout: 20000 })

    // Toggle Camera (Bob)
    console.log('Bob toggling camera...')
    await bobPage.click('call-overlay .active-view button:has(.bi-camera-video-fill), call-overlay .active-view button:has(.bi-camera-video-off-fill)')
    await expect(bobVideoBtn).toHaveClass(/btn-danger/)
    await expect(bobVideoBtn.locator('i')).toHaveClass(/bi-camera-video-off-fill/)

    // End Call (Bob)
    console.log('Bob ending call...')
    await bobPage.click('call-overlay .active-view button:has(.bi-telephone-x-fill)')

    // Verify overlay is hidden for both
    console.log('Verifying call overlay is hidden...')
    await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
    await expect(bobPage.locator('call-overlay .modal')).not.toBeVisible()
  })
})
