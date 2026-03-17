import { test, expect } from '@playwright/test'

test.describe('Text Chat', () => {
  test.describe.configure({ mode: 'serial' })

  let aliceContext
  let bobContext
  let alicePage
  let bobPage

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(90000)
    aliceContext = await browser.newContext()
    bobContext = await browser.newContext()

    alicePage = await aliceContext.newPage()
    bobPage = await bobContext.newPage()

    alicePage.on('console', msg => console.log('ALICE CONSOLE:', msg.text()))
    alicePage.on('pageerror', err => console.log('ALICE ERROR:', err.message))
    bobPage.on('console', msg => console.log('BOB CONSOLE:', msg.text()))
    bobPage.on('pageerror', err => console.log('BOB ERROR:', err.message))

    // Login Alice
    await alicePage.goto('/')
    await alicePage.locator('#coralite-login__username-0').fill('alice')
    await alicePage.locator('#coralite-login__password-0').fill('password123')
    await alicePage.locator('#coralite-login__submitButton-0').click()
    await expect(alicePage.getByRole('button', { name: 'New Room' })).toBeVisible({ timeout: 10000 })

    // Login Bob
    await bobPage.goto('/', { waitUntil: 'domcontentloaded' })
    await bobPage.locator('#coralite-login__username-0').fill('bob')
    await bobPage.locator('#coralite-login__password-0').fill('password123')
    await bobPage.locator('#coralite-login__submitButton-0').click()
    await expect(bobPage.getByRole('button', { name: 'New Room' })).toBeVisible({ timeout: 10000 })
  })

  test.afterAll(async () => {
    await aliceContext.close()
    await bobContext.close()
  })

  test('Room Creation and Real-time Messaging', async () => {
    // User A creates a room
    await alicePage.locator('#coralite-chat-list__openNewRoomModalBtn-0').click()
    const roomNameInput = alicePage.locator('#coralite-chat-list__roomNameInput-0')
    if (!await roomNameInput.isVisible()) {
      await alicePage.evaluate(() => {
        const modal = document.querySelector('[id^="coralite-chat-list__newRoomModal"]')
        if (modal && window.imports && window.imports.bootstrap) window.imports.bootstrap.Modal.getOrCreateInstance(modal).show()
        else if (modal && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(modal).show()
      })
      await expect(roomNameInput).toBeVisible({ timeout: 5000 })
    }
    await roomNameInput.fill('Alice and Bob Chat')
    await alicePage.locator('#coralite-chat-list__createRoomBtn-0').click()

    // Wait for room to be created and appear in the list
    await expect(alicePage.locator('.room-item', { hasText: 'Alice and Bob Chat' })).toBeVisible({ timeout: 15000 })
    await alicePage.waitForTimeout(1000)

    // Select the room
    await alicePage.locator('.room-item', { hasText: 'Alice and Bob Chat' }).click()

    // Invite Bob
    await alicePage.locator('#coralite-chat-window__openInviteModalBtn-0').click()
    const inviteInput = alicePage.locator('#coralite-chat-window__inviteUserIdInput-0')
    if (!await inviteInput.isVisible()) {
      await alicePage.evaluate(() => {
        const modal = document.querySelector('[id^="coralite-chat-window__inviteModal"]')
        if (modal && window.imports && window.imports.bootstrap) window.imports.bootstrap.Modal.getOrCreateInstance(modal).show()
        else if (modal && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(modal).show()
      })
      await expect(inviteInput).toBeVisible({ timeout: 5000 })
    }
    await inviteInput.fill('@bob:localhost')
    await alicePage.locator('#coralite-chat-window__sendInviteBtn-0').click()

    // Bob accepts the invite
    await expect(bobPage.locator('.room-item', { hasText: 'Alice and Bob Chat' })).toBeVisible({ timeout: 15000 })
    await bobPage.waitForTimeout(1000)
    await bobPage.locator('.room-item', { hasText: 'Alice and Bob Chat' }).click()
    await bobPage.waitForTimeout(1000)

    // There might be a "Join" button Bob has to click
    const joinButton = bobPage.locator('#coralite-chat-window__joinRoomBtn-0')
    if (await joinButton.isVisible()) {
      await joinButton.click()
    }

    // Alice sends a message
    const msgInput = alicePage.locator('#coralite-chat-input__messageInput-0')
    await expect(msgInput).toBeVisible({ timeout: 15000 })
    await msgInput.fill('Hello Bob!')
    await alicePage.locator('#coralite-chat-input__sendBtn-0').click()

    // Bob receives it in real-time
    await expect(bobPage.getByText('Hello Bob!').first()).toBeVisible({ timeout: 15000 })
  })

  test('Auto-Scroll on Rapid Messages', async () => {
    // Send 20 messages rapidly from Alice
    for (let i = 0; i < 20; i++) {
      await alicePage.locator('#coralite-chat-input__messageInput-0').fill(`Rapid message ${i}`)
      await alicePage.locator('#coralite-chat-input__sendBtn-0').click()
      await expect(alicePage.locator('#coralite-chat-input__messageInput-0')).toHaveValue('', { timeout: 5000 })
    }

    // Wait for the last message to appear for Alice
    await expect(alicePage.getByText('Rapid message 19').first()).toBeVisible({ timeout: 15000 })

    await alicePage.waitForTimeout(500) // Small wait for smooth scroll to finish

    // Verify that the timeline is scrolled to the bottom
    const isAtBottom = await alicePage.evaluate(() => {
      const container = document.querySelector('#coralite-chat-timeline__messagesContainer-0')
      if (!container) return false
      return Math.abs(container.scrollHeight - container.clientHeight - container.scrollTop) < 5
    })

    expect(isAtBottom).toBeTruthy()
  })

  test('Unread Badges', async () => {
    // Bob clicks away to a different room or tab (e.g., settings)
    await bobPage.getByRole('button', { name: 'Settings' }).click()

    // Alice sends a message
    await alicePage.locator('#coralite-chat-input__messageInput-0').fill('Are you there Bob?')
    await alicePage.locator('#coralite-chat-input__sendBtn-0').click()

    // Verify Bob's sidebar shows a red unread badge
    const badge = bobPage.locator('.badge.text-bg-danger').first()
    await expect(badge).toBeVisible({ timeout: 10000 })
    // It should have some count
    await expect(badge).not.toBeEmpty()
  })
})
