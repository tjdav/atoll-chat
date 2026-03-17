import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test.describe('WebTorrent File Transfer', () => {
  let aliceContext
  let bobContext
  let alicePage
  let bobPage

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000)
    aliceContext = await browser.newContext()
    bobContext = await browser.newContext()

    alicePage = await aliceContext.newPage()
    bobPage = await bobContext.newPage()

    // Setup both users and navigate to the same room (assuming created in previous test)
    // Note: in a true independent test suite we'd setup the room here.

    // Login Alice
    await alicePage.goto('/')
    await alicePage.locator('#coralite-login__username-0').waitFor({
      state: 'visible',
      timeout: 15000
    })
    await alicePage.locator('#coralite-login__username-0').fill('alice')
    await alicePage.locator('#coralite-login__password-0').fill('password123')
    await alicePage.locator('#coralite-login__submitButton-0').click()
    await expect(alicePage.locator('#coralite-app-layout__layoutContainer-0')).toBeVisible({ timeout: 10000 })

    // Login Bob
    await bobPage.goto('/')
    await bobPage.locator('#coralite-login__username-0').waitFor({
      state: 'visible',
      timeout: 15000
    })
    await bobPage.locator('#coralite-login__username-0').fill('bob')
    await bobPage.locator('#coralite-login__password-0').fill('password123')
    await bobPage.locator('#coralite-login__submitButton-0').click()
    await expect(bobPage.locator('#coralite-app-layout__layoutContainer-0')).toBeVisible({ timeout: 10000 })

    // Create a new room specifically for file transfer test
    await alicePage.locator('button[data-bs-target="#newRoomModal"]').first().click()
    await expect(alicePage.locator('#newRoomModal')).toBeVisible({ timeout: 15000 })
    await alicePage.locator('#coralite-chat-list__roomNameInput-0').fill('File Transfer Room')
    await alicePage.locator('#coralite-chat-list__createRoomBtn-0').click()

    // Invite Bob
    await expect(alicePage.getByText('File Transfer Room').first()).toBeVisible({ timeout: 10000 })
    await alicePage.getByText('File Transfer Room').first().click()
    await expect(alicePage.locator('button[aria-label="Invite"]')).toBeVisible({ timeout: 10000 })
    await alicePage.locator('button[aria-label="Invite"]').click()
    await expect(alicePage.locator('#coralite-chat-window__inviteUserIdInput-0')).toBeVisible({ timeout: 10000 })
    await alicePage.locator('#coralite-chat-window__inviteUserIdInput-0').fill('@bob:localhost')
    await alicePage.locator('#coralite-chat-window__sendInviteBtn-0').click()

    // Bob accepts
    await expect(bobPage.locator('coralite-chat-list')).toContainText('File Transfer Room', { timeout: 10000 })
    await bobPage.getByText('File Transfer Room').first().click()
    const joinButton = bobPage.getByRole('button', { name: 'Join' })
    if (await joinButton.isVisible()) {
      await joinButton.click()
    }
  })

  test.afterAll(async () => {
    await aliceContext.close()
    await bobContext.close()
  })

  test('Sending File', async () => {
    // User A attaches a fixture file
    const filePath = path.join(__dirname, 'fixtures/test-files/test.jpg')

    // Assume an input[type="file"] exists natively or within a shadow DOM
    // Playwright can interact directly with the file input element.
    const fileChooserPromise = alicePage.waitForEvent('filechooser')
    await alicePage.getByRole('button', { name: 'Attach File' }).click() // The button that triggers file select
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(filePath)

    // Wait for upload/seed
    await alicePage.locator('#coralite-chat-input__sendBtn-0').click()

    // Verify the torrent bubble appears for User A with a "Seeding" state
    const torrentBubble = alicePage.locator('coralite-torrent-bubble')
    await expect(torrentBubble).toBeVisible({ timeout: 10000 })
    await expect(torrentBubble).toContainText('Seeding')
  })

  test('Receiving File', async () => {
    // Verify the bubble appears for User B with a "Download" button
    const torrentBubble = bobPage.locator('coralite-torrent-bubble')
    await expect(torrentBubble).toBeVisible({ timeout: 15000 })
    const downloadButton = torrentBubble.getByRole('button', { name: 'Download' })
    await expect(downloadButton).toBeVisible()
  })

  test('P2P Transfer & Decryption', async () => {
    // User B clicks Download
    const downloadButton = bobPage.locator('coralite-torrent-bubble').getByRole('button', { name: 'Download' })
    await downloadButton.click()

    // Wait for the WebTorrent progress bar to complete (assumes a progress indicator exists)
    // We check for the bubble transforming into an <img> tag showing the downloaded blob
    // Depending on structure, it might still be a coralite-torrent-bubble but contain an img
    const imgElement = bobPage.locator('coralite-torrent-bubble img')
    await expect(imgElement).toBeVisible({ timeout: 30000 }) // File transfer can take a bit

    // Verify the img has a blob src
    const src = await imgElement.getAttribute('src')
    expect(src).toMatch(/^blob:/)
  })
})
