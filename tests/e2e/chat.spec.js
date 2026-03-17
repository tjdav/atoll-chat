import { test, expect } from '@playwright/test'

test.describe('Text Chat', () => {
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
    await alicePage.getByRole('button', { name: 'New Room' }).click()
    await alicePage.getByLabel('Room Name').fill('Alice and Bob Chat')
    await alicePage.getByRole('button', { name: 'Create' }).click()

    // Wait for room to be created and appear in the list
    await expect(alicePage.getByText('Alice and Bob Chat')).toBeVisible()

    // Select the room
    await alicePage.getByText('Alice and Bob Chat').click()

    // Invite Bob
    await alicePage.getByRole('button', { name: 'Invite' }).click()
    await alicePage.getByLabel('User ID').fill('@bob:localhost')
    await alicePage.getByRole('button', { name: 'Send Invite' }).click()

    // Bob accepts the invite
    await expect(bobPage.getByText('Alice and Bob Chat')).toBeVisible()
    await bobPage.getByText('Alice and Bob Chat').click()

    // There might be a "Join" button Bob has to click
    const joinButton = bobPage.getByRole('button', { name: 'Join' })
    if (await joinButton.isVisible()) {
      await joinButton.click()
    }

    // Alice sends a message
    await alicePage.getByRole('textbox', { name: 'Message' }).fill('Hello Bob!')
    await alicePage.getByRole('button', { name: 'Send' }).click()

    // Bob receives it in real-time
    await expect(bobPage.getByText('Hello Bob!')).toBeVisible({ timeout: 10000 })
  })

  test('Auto-Scroll on Rapid Messages', async () => {
    // Send 20 messages rapidly from Alice
    for (let i = 0; i < 20; i++) {
      await alicePage.getByRole('textbox', { name: 'Message' }).fill(`Rapid message ${i}`)
      await alicePage.getByRole('button', { name: 'Send' }).click()
    }

    // Wait for the last message to appear for Alice
    await expect(alicePage.getByText('Rapid message 19')).toBeVisible({ timeout: 10000 })

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
    await alicePage.getByRole('textbox', { name: 'Message' }).fill('Are you there Bob?')
    await alicePage.getByRole('button', { name: 'Send' }).click()

    // Verify Bob's sidebar shows a red unread badge
    const badge = bobPage.locator('.badge.bg-danger').first()
    await expect(badge).toBeVisible({ timeout: 10000 })
    // It should have some count
    await expect(badge).not.toBeEmpty()
  })
})
