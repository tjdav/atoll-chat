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
    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
  }

  async function createRoom (callerPage, receiverPage, receiverName, callerName) {
    await callerPage.click('button[title="Create Room"]')
    await callerPage.fill('input[placeholder="Search by username..."]', receiverName)
    await callerPage.click(`.search-result-item:has-text("${receiverName}")`)
    await callerPage.click('button:has-text("Create Room")')
    await expect(callerPage.locator('chat-view header h6')).toContainText(receiverName)

    const receiverChatListCaller = receiverPage.locator('chat-list .app-list-item').filter({ hasText: callerName }).first()
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
    const pipWindow = alicePage.locator('[data-testid="pip-video-0__pipWindow"]')
    await expect(pipWindow).toBeVisible()

    // Verify remote video is visible in PiP
    const remoteVideo = alicePage.locator('[data-testid="video-grid-0__remoteVideo"]')
    await expect(remoteVideo).toBeVisible({ timeout: 10000 })

    // Ensure video is playing
    await expect.poll(async () => {
      return alicePage.evaluate(() => {
        const video = document.querySelector('[data-testid="video-grid-0__remoteVideo"]')
        return {
          readyState: video.readyState,
          paused: video.paused
        }
      })
    }, { timeout: 20000 }).toMatchObject({
      readyState: 4,
      paused: false
    })

    // Ensure placeholder is hidden (this was the reported issue)
    // Wait for it to disappear
    await expect(alicePage.locator('[data-testid="video-grid-0__remotePlaceholder"]')).not.toBeVisible({ timeout: 10000 })

    // Assert local video is hidden in PiP
    const localVideo = alicePage.locator('[data-testid="video-grid-0__localVideo"]')
    await expect(localVideo).not.toBeVisible()

    console.log('Alice sending a message while in PiP...')
    const messageText = 'Still here in PiP!'
    await alicePage.fill('chat-input textarea', messageText)
    await alicePage.keyboard.press('Enter')

    // Verify message sent and visible in timeline
    await expect(alicePage.locator('message-timeline')).toContainText(messageText)
    await expect(bobPage.locator('message-timeline')).toContainText(messageText)

    console.log('Alice expanding back to full screen...')
    // Hover to show expand button
    await pipWindow.hover()
    await alicePage.waitForTimeout(500)
    await alicePage.click('[data-testid="pip-video-0__btnExpand"]')

    await expect(alicePage.locator('call-overlay .modal')).toBeVisible()
    await expect(pipWindow).not.toBeVisible()

    // Verify remote video is still visible in full screen
    await expect(remoteVideo).toBeVisible({ timeout: 10000 })
    await expect(alicePage.locator('[data-testid="video-grid-0__remotePlaceholder"]')).not.toBeVisible({ timeout: 10000 })

    // Assert local video is visible again in full screen
    await expect(localVideo).toBeVisible()

    console.log('Alice ending call from full screen...')
    await alicePage.click('[data-testid="call-overlay-0__btnEndCall"]')
    await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
    await expect(pipWindow).not.toBeVisible()
  })
})
