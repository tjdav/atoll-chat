import { test, expect } from './fixtures/base-test.js'

test.describe('Chat Auto-Scroll', () => {
  test('should auto-scroll when user sends a message, but not when receiving from others while scrolled up', async ({ browser }) => {
    test.setTimeout(180000)

    // 1. Setup Alice's context and page
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()

    // 2. Setup Bob's context and page
    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()

    const login = async (p, username) => {
      console.log(`Logging in ${username}...`)
      await p.goto('/')
      await p.waitForSelector('input[placeholder="Enter username or email"]')
      await p.fill('input[placeholder="Enter username or email"]', username)
      await p.fill('input[placeholder="Enter Password"]', 'Password123!')
      await p.click('button:has-text("Login")')
      await expect(p.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible({ timeout: 30000 })
      await p.fill('input[placeholder="Enter Vault Password"]', 'VaultPassword123!')
      await p.click('button:has-text("Unlock with Password")')
      await expect(p.locator('app-layout')).toBeVisible({ timeout: 40000 })
    }

    await login(alicePage, 'alice')
    await login(bobPage, 'bob')

    console.log('Alice creating room with Bob...')
    await alicePage.click('button[title="Create Room"]')
    await alicePage.waitForSelector('input[placeholder="Search by username..."]')
    await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
    // Wait for the search result to be populated
    await alicePage.waitForTimeout(2000)
    await alicePage.click('.search-result-item:has-text("bob")')
    await alicePage.click('button:has-text("Create Room")')

    await expect(alicePage.locator('chat-view')).toBeVisible({ timeout: 20000 })
    await expect(alicePage.locator('chat-view header h6')).toContainText('bob', { timeout: 20000 })

    // Bob opens the same chat
    console.log('Bob opening chat with Alice...')
    const bobChatListAlice = bobPage.locator('chat-list .app-list-item').filter({ hasText: 'alice' }).first()
    await expect(bobChatListAlice).toBeVisible({ timeout: 40000 })
    await bobChatListAlice.click()
    await expect(bobPage.locator('chat-view')).toBeVisible({ timeout: 20000 })

    // 3. Populate Alice's timeline with many messages to enable scrolling
    console.log('Populating timeline with many messages...')
    const aliceInput = alicePage.locator('textarea[placeholder="Type a message..."]')
    for (let i = 0; i < 20; i++) {
      await aliceInput.fill(`Population message ${i}`)
      await alicePage.keyboard.press('Enter')
      await alicePage.waitForTimeout(300)
    }

    // Wait for messages to be rendered
    await expect(alicePage.locator('timeline-row').last()).toContainText('Population message 19', { timeout: 20000 })

    // 4. Scroll Alice to the top
    console.log('Scrolling Alice to top...')
    // Robust selector for the timeline container
    const timelineContainer = alicePage.locator('message-timeline div.overflow-auto').first()
    await timelineContainer.evaluate((el) => {
      el.scrollTop = 0
    })
    await alicePage.waitForTimeout(2000)

    const scrollTopAfterScrollUp = await timelineContainer.evaluate(el => el.scrollTop)
    console.log(`Scroll top after scrolling up: ${scrollTopAfterScrollUp}`)
    expect(scrollTopAfterScrollUp).toBeLessThan(50)

    // 5. Bob sends a message - Alice should NOT auto-scroll
    console.log('Bob sends a message...')
    const bobMessageText = 'Bob says hello while Alice is scrolled up'
    await bobPage.fill('textarea[placeholder="Type a message..."]', bobMessageText)
    await bobPage.keyboard.press('Enter')

    // Verify Alice receives the message in the DOM
    await expect(alicePage.locator('timeline-row').filter({ hasText: bobMessageText })).toBeVisible({ timeout: 20000 })

    // Check Alice's scroll position - should still be near top
    const scrollTopAfterBobMessage = await timelineContainer.evaluate(el => el.scrollTop)
    console.log(`Scroll top after Bob's message: ${scrollTopAfterBobMessage}`)
    expect(scrollTopAfterBobMessage).toBeLessThan(150)

    // 6. Alice sends a message - Alice SHOULD auto-scroll to bottom
    console.log('Alice sends a message...')
    const aliceFinalMessage = 'I am sending a message and it should jump to bottom'
    await aliceInput.fill(aliceFinalMessage)
    await alicePage.keyboard.press('Enter')

    // Wait for smooth scroll
    await alicePage.waitForTimeout(3000)

    const scrollTopAfterAliceMessage = await timelineContainer.evaluate(el => el.scrollTop)
    const scrollHeight = await timelineContainer.evaluate(el => el.scrollHeight)
    const clientHeight = await timelineContainer.evaluate(el => el.clientHeight)

    console.log(`Final scroll position: ${scrollTopAfterAliceMessage}/${scrollHeight - clientHeight}`)

    // Check if we are at the bottom
    expect(scrollTopAfterAliceMessage).toBeGreaterThan(scrollHeight - clientHeight - 50)

    console.log('Auto-scroll test completed successfully!')
    await aliceContext.close()
    await bobContext.close()
  })
})
