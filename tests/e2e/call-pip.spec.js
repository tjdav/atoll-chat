import { test, expect } from './fixtures/base-test.js'

test.describe.serial('Call PiP', () => {
  let aliceContext, alicePage
  let bobContext, bobPage

  test.beforeAll(async ({ browser }) => {
    aliceContext = await browser.newContext()
    alicePage = await aliceContext.newPage()
    bobContext = await browser.newContext()
    bobPage = await bobContext.newPage()

    // Attach console listeners
    alicePage.on('console', msg => console.log(`[ALICE BROWSER] ${msg.type()}: ${msg.text()}`))
    bobPage.on('console', msg => console.log(`[BOB BROWSER] ${msg.type()}: ${msg.text()}`))
  })

  test.afterAll(async () => {
    await aliceContext?.close()
    await bobContext?.close()
  })

  async function loginAndSetup (loginCustomPage) {
    await loginCustomPage(alicePage, 'alice', 'Password123!', '123456')
    await loginCustomPage(bobPage, 'bob', 'Password123!', '123456')
  }

  async function createRoom (callerPage, receiverPage, receiverName, callerName) {
    await callerPage.click('button[title="Create Room"]')
    await callerPage.fill('input[placeholder="Search by username..."]', receiverName)
    await callerPage.click(`.search-result-item:has-text("${receiverName}")`)
    await callerPage.click('button:has-text("Create Room")')
    await expect(callerPage.locator('chat-view header h6')).toContainText(receiverName)

    const receiverChatListCaller = receiverPage.locator('chat-list .list-group-item').filter({ hasText: callerName }).first()
    await expect(receiverChatListCaller).toBeVisible({ timeout: 30000 })
    await receiverChatListCaller.click()
    await expect(receiverPage.locator('chat-view header h6')).toContainText(callerName)
  }

  test('Alice can enter PiP and continue chatting', async ({ loginCustomPage }) => {
    await loginAndSetup(loginCustomPage)
    await createRoom(alicePage, bobPage, 'bob', 'alice')

    console.log('Alice initiating video call...')
    await alicePage.click('button[title="Video Call"]')

    console.log('Bob accepting call...')
    await expect(bobPage.locator('call-overlay .incoming-view')).toBeVisible({ timeout: 20000 })
    await bobPage.click('call-overlay button[title="Accept Call"]')

    // Both in active call
    await expect(alicePage.locator('call-overlay .active-view')).toBeVisible()

    console.log('Alice entering PiP mode...')
    await alicePage.click('[data-testid="call-overlay-0__btnPip"]')

    // Verify modal is hidden but PiP is visible
    await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
    // TestID for pipWindow inside pip-video component
    const pipWindow = alicePage.locator('[data-testid="pip-video-0__pipWindow"]')
    await expect(pipWindow).toBeVisible()

    await alicePage.screenshot({ path: '/home/jules/verification/screenshots/pip_active.png' })

    // Hover to show controls
    await pipWindow.hover()
    await alicePage.waitForTimeout(500)
    await alicePage.screenshot({ path: '/home/jules/verification/screenshots/pip_controls.png' })

    console.log('Alice sending a message while in PiP...')
    const messageText = 'Still here in PiP!'
    await alicePage.fill('chat-input textarea', messageText)
    await alicePage.keyboard.press('Enter')

    // Verify message sent and visible in timeline
    await expect(alicePage.locator('message-timeline')).toContainText(messageText)
    await expect(bobPage.locator('message-timeline')).toContainText(messageText)

    console.log('Alice toggling audio in PiP...')
    const pipAudioBtn = alicePage.locator('[data-testid="pip-video-0__btnToggleAudio"]')
    await pipAudioBtn.click()
    await expect(pipAudioBtn).toHaveClass(/btn-danger/)

    console.log('Alice expanding back to full screen...')
    await alicePage.click('[data-testid="pip-video-0__btnExpand"]')
    await expect(alicePage.locator('call-overlay .modal')).toBeVisible()
    await expect(pipWindow).not.toBeVisible()

    console.log('Alice ending call from full screen...')
    await alicePage.click('[data-testid="call-overlay-0__btnEndCall"]')
    await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
    await expect(pipWindow).not.toBeVisible()
  })

  test('Alice can end call directly from PiP', async () => {
    await createRoom(alicePage, bobPage, 'bob', 'alice')
    await alicePage.click('button[title="Video Call"]')
    await bobPage.click('call-overlay button[title="Accept Call"]')

    await alicePage.click('[data-testid="call-overlay-0__btnPip"]')
    const pipWindow = alicePage.locator('[data-testid="pip-video-0__pipWindow"]')
    await expect(pipWindow).toBeVisible()

    console.log('Alice ending call from PiP...')
    await alicePage.click('[data-testid="pip-video-0__btnEndCall"]')

    await expect(pipWindow).not.toBeVisible()
    await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
  })
})
