import { test, expect } from '@playwright/test'

test.describe('Text Chat', () => {
  let aliceContext
  let bobContext
  let alicePage
  let bobPage

  test.beforeAll(async ({ browser }) => {
    aliceContext = await browser.newContext()
    bobContext = await browser.newContext()

    alicePage = await aliceContext.newPage()
    bobPage = await bobContext.newPage()

    // Login Alice
    await alicePage.goto('/')
    await alicePage.locator('coralite-login').getByLabel('Username').fill('alice')
    await alicePage.locator('coralite-login').getByLabel('Password').fill('password123')
    await alicePage.locator('coralite-login').getByRole('button', { name: 'Log In' }).click()
    await expect(alicePage.locator('coralite-app-layout')).toBeVisible({ timeout: 10000 })

    // Login Bob
    await bobPage.goto('/')
    await bobPage.locator('coralite-login').getByLabel('Username').fill('bob')
    await bobPage.locator('coralite-login').getByLabel('Password').fill('password123')
    await bobPage.locator('coralite-login').getByRole('button', { name: 'Log In' }).click()
    await expect(bobPage.locator('coralite-app-layout')).toBeVisible({ timeout: 10000 })
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
    await expect(alicePage.locator('coralite-chat-list')).toContainText('Alice and Bob Chat')

    // Select the room
    await alicePage.getByText('Alice and Bob Chat').click()

    // Invite Bob (assuming there is an invite flow, simplify if there's a specific UI for this)
    // Often you type Bob's Matrix ID or username. Let's assume there's an invite input.
    // If we assume Bob auto-joins public rooms or we invite him:
    await alicePage.getByRole('button', { name: 'Invite' }).click()
    await alicePage.getByLabel('User ID').fill('@bob:localhost')
    await alicePage.getByRole('button', { name: 'Send Invite' }).click()

    // Bob accepts the invite
    await expect(bobPage.locator('coralite-chat-list')).toContainText('Alice and Bob Chat')
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
    await expect(bobPage.locator('coralite-chat-timeline')).toContainText('Hello Bob!', { timeout: 10000 })
  })

  test('Auto-Scroll on Rapid Messages', async () => {
    // Send 20 messages rapidly from Alice
    for (let i = 0; i < 20; i++) {
      await alicePage.getByRole('textbox', { name: 'Message' }).fill(`Rapid message ${i}`)
      await alicePage.getByRole('button', { name: 'Send' }).click()
    }

    // Wait for the last message to appear for Alice
    await expect(alicePage.locator('coralite-chat-timeline')).toContainText('Rapid message 19', { timeout: 10000 })

    // Verify that the timeline is scrolled to the bottom
    const isAtBottom = await alicePage.evaluate(() => {
      // Find the scrollable container within the shadow DOM or standard DOM
      const timeline = document.querySelector('coralite-chat-timeline')
      // Often the internal scrollable element is a specific div
      const container = timeline.shadowRoot ? timeline.shadowRoot.querySelector('.timeline-container') || timeline : timeline

      // Allow a small margin of error (e.g., 5px) for browser rendering differences
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
    const badge = bobPage.locator('coralite-chat-list .badge.bg-danger')
    await expect(badge).toBeVisible({ timeout: 10000 })
    // It should have some count
    await expect(badge).not.toBeEmpty()
  })
})
