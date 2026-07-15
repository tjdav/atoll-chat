import { test, expect } from './fixtures/base-test.js'

test.describe.serial('Calls', () => {
  let aliceContext, alicePage
  let bobContext, bobPage

  test.beforeEach(async ({ browser, loginCustomPage }) => {
    aliceContext = await browser.newContext()
    alicePage = await aliceContext.newPage()
    bobContext = await browser.newContext()
    bobPage = await bobContext.newPage()

    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

    // Setup room
    await alicePage.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await alicePage.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await alicePage.locator('[data-testid$="search-result-bob"]').click()
    await alicePage.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
    await expect(alicePage.locator('chat-view header h6')).toContainText('bob', { timeout: 15000 })

    const bobChat = bobPage.locator('chat-list .app-list-item').filter({ hasText: 'alice' }).first()
    await expect(bobChat).toBeVisible({ timeout: 15000 })
    await bobChat.click()
    await expect(bobPage.locator('chat-view header h6')).toContainText('alice', { timeout: 15000 })
  })

  test.afterEach(async () => {
    await aliceContext?.close()
    await bobContext?.close()
  })

  test('Audio Call between Alice and Bob', async () => {
    console.log('Alice initiating audio call...')
    await alicePage.locator('[data-testid="chat-view-0__btnAudioCall"]').click()

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
    await alicePage.locator('[data-testid="chat-view-0__btnVideoCall"]').click()

    await expect(bobPage.locator('call-overlay .incoming-view')).toBeVisible({ timeout: 20000 })
    await bobPage.click('call-overlay button[title="Accept Call"]')

    await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })

    // Verify media flow (assert that remote stream is attached)
    await expect.poll(async () => {
      return await alicePage.evaluate(() => {
        const video = document.querySelector('video-grid video.remote-video')
        return video && video.srcObject !== null
      })
    }, { timeout: 25000 }).toBe(true)

    await expect.poll(async () => {
      return await bobPage.evaluate(() => {
        const video = document.querySelector('video-grid video.remote-video')
        return video && video.srcObject !== null
      })
    }, { timeout: 25000 }).toBe(true)

    // Enter PiP
    await alicePage.click('[ref$="__btnPip"]')
    await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
    const pipWindow = alicePage.locator('[ref$="__pipWindow"]')
    await expect(pipWindow).toBeVisible()

    // Send message while in PiP
    const msg = 'Still here in PiP!'
    await alicePage.fill('chat-input textarea', msg)
    await alicePage.keyboard.press('Enter')
    await expect(alicePage.locator('message-timeline')).toContainText(msg)

    // Expand back
    await pipWindow.hover()
    await alicePage.click('[ref$="__btnExpand"]')
    await expect(alicePage.locator('call-overlay .modal')).toBeVisible()

    await alicePage.click('[ref$="__btnEndCall"]')
    await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
  })
})
