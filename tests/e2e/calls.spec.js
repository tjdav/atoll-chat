import { test, expect } from './fixtures/base-test.js'

test.describe.serial('Calls', () => {
  let aliceContext, alicePage
  let bobContext, bobPage

  test.beforeEach(async ({ browser, loginCustomPage }) => {
    test.slow()
    aliceContext = await browser.newContext()
    alicePage = await aliceContext.newPage()
    bobContext = await browser.newContext()
    bobPage = await bobContext.newPage()

    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

    // Setup room
    await alicePage.click('button[title="Create Room"]')
    await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
    await alicePage.waitForSelector('.search-result-item:has-text("bob")', { timeout: 10000 })
    await alicePage.click('.search-result-item:has-text("bob")')
    await alicePage.click('button:has-text("Create Room")')
    await expect(alicePage.locator('chat-view header h6')).toContainText('bob', { timeout: 15000 })

    const bobChat = bobPage.locator('chat-list .app-list-item').filter({ hasText: 'alice' }).first()
    await expect(bobChat).toBeVisible({ timeout: 30000 })
    await bobChat.click()
    await expect(bobPage.locator('chat-view header h6')).toContainText('alice', { timeout: 15000 })
  })

  test.afterEach(async () => {
    await aliceContext?.close()
    await bobContext?.close()
  })

  test('Audio Call between Alice and Bob', async () => {
    console.log('Alice initiating audio call...')
    await alicePage.click('button[title="Audio Call"]')

    const bobIncomingView = bobPage.locator('call-overlay .incoming-view')
    await expect(bobIncomingView).toBeVisible({ timeout: 20000 })
    await expect(bobIncomingView.locator('h2')).not.toHaveText('Unknown Caller', { timeout: 10000 })

    console.log('Bob accepting call...')
    await bobPage.click('call-overlay button[title="Accept Call"]')

    await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })
    await expect(bobPage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })

    // Verify initial states (Alice: Mic ON, Cam OFF)
    const aliceAudioBtn = alicePage.locator('call-overlay .active-view button:has(.bi-mic-fill), call-overlay .active-view button:has(.bi-mic-mute-fill)')
    const aliceVideoBtn = alicePage.locator('call-overlay .active-view button:has(.bi-camera-video-fill), call-overlay .active-view button:has(.bi-camera-video-off-fill)')
    await expect(aliceAudioBtn).toHaveClass(/btn-light/)
    await expect(aliceVideoBtn).toHaveClass(/btn-danger/)

    // Toggle Mute
    await alicePage.click('call-overlay .active-view button:has(.bi-mic-fill), call-overlay .active-view button:has(.bi-mic-mute-fill)')
    await expect(aliceAudioBtn).toHaveClass(/btn-danger/)
    await expect(aliceAudioBtn.locator('i')).toHaveClass(/bi-mic-mute-fill/)

    // End Call
    await alicePage.click('call-overlay .active-view button:has(.bi-telephone-x-fill)')
    await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
    await expect(bobPage.locator('call-overlay .modal')).not.toBeVisible()
  })

  test('Video Call with PiP and Messaging', async () => {
    console.log('Alice initiating video call...')
    await alicePage.click('button[title="Video Call"]')

    await expect(bobPage.locator('call-overlay .incoming-view')).toBeVisible({ timeout: 20000 })
    await bobPage.click('call-overlay button[title="Accept Call"]')

    await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })
    
    // Verify media flow
    await expect(alicePage.locator('video-grid video.remote-video')).toHaveJSProperty('readyState', 4, { timeout: 25000 })
    await expect(bobPage.locator('video-grid video.remote-video')).toHaveJSProperty('readyState', 4, { timeout: 25000 })

    // Enter PiP
    await alicePage.click('[data-testid="call-overlay-0__btnPip"]')
    await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
    const pipWindow = alicePage.locator('[data-testid="pip-video-0__pipWindow"]')
    await expect(pipWindow).toBeVisible()

    // Send message while in PiP
    const msg = 'Still here in PiP!'
    await alicePage.fill('chat-input textarea', msg)
    await alicePage.keyboard.press('Enter')
    await expect(alicePage.locator('message-timeline')).toContainText(msg)

    // Expand back
    await pipWindow.hover()
    await alicePage.click('[data-testid="pip-video-0__btnExpand"]')
    await expect(alicePage.locator('call-overlay .modal')).toBeVisible()

    await alicePage.click('[data-testid="call-overlay-0__btnEndCall"]')
    await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
  })
})
