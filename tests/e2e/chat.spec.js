import { test, expect } from '@playwright/test'

test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-loopback-in-peer-connection',
      '--enforce-webrtc-ip-permission-check=false',
      '--unlimited-storage'
    ]
  }
})

const login = async (page, username) => {
  await page.goto('/')
  await page.waitForSelector('text=Login to Matrix')
  await page.fill('input[placeholder="Homeserver URL"]', 'http://localhost:6167')
  await page.fill('input[placeholder="Username"]', username)
  await page.fill('input[placeholder="Password"]', 'password123')
  await page.click('button:has-text("Login")')
  await expect(page.locator('h5').filter({ hasText: 'Chats' })).toBeVisible()
}

test('Alice creates a room, invites Bob, Bob invites Charlie, all see history', async ({ browser }) => {
  test.setTimeout(60000)

  // --- Alice's Context ---
  const aliceContext = await browser.newContext()
  const alicePage = await aliceContext.newPage()

  await login(alicePage, 'alice')

  // Alice creates a room
  await alicePage.getByRole('button', { name: 'New Room' }).click()
  await alicePage.fill('input[id*="roomNameInput"]', 'The Hangout')
  await alicePage.getByRole('button', { name: 'Create' }).click()

  // Wait for room to appear in the list and click it
  await expect(alicePage.locator('.list-group-item', { hasText: 'The Hangout' })).toBeVisible()
  await alicePage.locator('.list-group-item', { hasText: 'The Hangout' }).click()

  // Alice sends an initial message
  const aliceInput = alicePage.locator('input[placeholder="Aa"]')
  await expect(aliceInput).toBeVisible()
  await aliceInput.fill('Welcome to the hangout!')
  // Wait for the send button to become visible (it changes from mic to send on input)
  await expect(alicePage.getByRole('button', { name: 'Send Message' })).toBeVisible()
  await alicePage.getByRole('button', { name: 'Send Message' }).click()

  // Verify message is sent
  await expect.poll(async () => {
    const text = await alicePage.locator('.message-bubble').allInnerTexts()
    return text.join(' ').includes('Welcome to the hangout!')
  }).toBeTruthy()

  // Alice invites Bob
  await alicePage.locator('button').filter({ has: alicePage.locator('i.bi-person-plus') }).first().click()
  await alicePage.fill('input[id*="inviteUserIdInput"]', '@bob:localhost')
  await alicePage.getByRole('button', { name: 'Send Invite' }).click()

  // --- Bob's Context ---
  const bobContext = await browser.newContext()
  const bobPage = await bobContext.newPage()

  await login(bobPage, 'bob')

  // Bob waits for the invite/room to appear in his list
  await expect(bobPage.locator('.list-group-item', { hasText: 'The Hangout' })).toBeVisible()
  await bobPage.locator('.list-group-item', { hasText: 'The Hangout' }).click()

  // Bob joins the room
  await bobPage.getByRole('button', { name: 'Join' }).click()

  // Bob verifies the history
  // If Matrix flakiness prevents the message from loading immediately, we will trigger sync requests and wait
  await expect(async () => {
    await bobPage.evaluate(() => window.document.dispatchEvent(new CustomEvent('matrix-sync-update')))
    const text = await bobPage.locator('.message-bubble').allInnerTexts()
    expect(text.join(' ').includes('Welcome to the hangout!')).toBeTruthy()
  }).toPass()

  // Bob responds
  const bobInput = bobPage.locator('input[placeholder="Aa"]')
  await expect(bobInput).toBeVisible()
  await bobInput.fill('Thanks Alice, glad to be here!')
  await expect(bobPage.getByRole('button', { name: 'Send Message' })).toBeVisible()
  await bobPage.getByRole('button', { name: 'Send Message' }).click()

  // Bob invites Charlie
  await bobPage.locator('button').filter({ has: bobPage.locator('i.bi-person-plus') }).first().click()
  await bobPage.fill('input[id*="inviteUserIdInput"]', '@charlie:localhost')
  await bobPage.getByRole('button', { name: 'Send Invite' }).click()

  // --- Charlie's Context ---
  const charlieContext = await browser.newContext()
  const charliePage = await charlieContext.newPage()

  await login(charliePage, 'charlie')

  // Charlie waits for the invite/room to appear
  await expect(charliePage.locator('.list-group-item', { hasText: 'The Hangout' })).toBeVisible()
  await charliePage.locator('.list-group-item', { hasText: 'The Hangout' }).click()

  // Charlie joins the room
  await charliePage.getByRole('button', { name: 'Join' }).click()

  // Charlie verifies history
  await expect(async () => {
    await charliePage.evaluate(() => window.document.dispatchEvent(new CustomEvent('matrix-sync-update')))
    const text = await charliePage.locator('.message-bubble').allInnerTexts()
    const joinedText = text.join(' ')
    expect(joinedText.includes('Welcome to the hangout!') && joinedText.includes('Thanks Alice, glad to be here!')).toBeTruthy()
  }).toPass()

  // Charlie sends a message
  const charlieInput = charliePage.locator('input[placeholder="Aa"]')
  await expect(charlieInput).toBeVisible()
  await charlieInput.fill('Hey everyone, thanks for the invite!')
  await expect(charliePage.getByRole('button', { name: 'Send Message' })).toBeVisible()
  await charliePage.getByRole('button', { name: 'Send Message' }).click()

  // Verify Alice sees all messages
  await expect(async () => {
    await alicePage.evaluate(() => window.document.dispatchEvent(new CustomEvent('matrix-sync-update')))
    const text = await alicePage.locator('.message-bubble').allInnerTexts()
    const joinedText = text.join(' ')
    expect(joinedText.includes('Hey everyone, thanks for the invite!')).toBeTruthy()
  }).toPass()
})
