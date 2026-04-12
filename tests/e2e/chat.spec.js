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

const verifyMessageReceived = async (page, text) => {
  const timeline = page.locator('atoll-chat-timeline')

  // Because matrix syncs can be flaky across multiple test contexts, wrap the sync
  // and scroll forcing in an auto-retrying block
  await expect(async () => {
    // 1. Check if there are any wrappers. If so, force them into view
    const wrappers = timeline.locator('[id^="msg-"]')
    const count = await wrappers.count()
    if (count > 0) {
      // Force scroll the latest message wrapper into view to trigger the IntersectionObserver
      await wrappers.last().scrollIntoViewIfNeeded()
    }

    // 2. Assert the text actually renders inside a message bubble!
    // Try scrolling again to be absolutely sure
    await timeline.evaluate((node) => {
      const container = node.querySelector('[ref="messagesContainer"]')
      if (container) {
        container.scrollTop = container.scrollHeight
      }
    })

    // Ensure Matrix sync processes
    await page.waitForTimeout(100)

    // Wait for the specific internal element that contains the text
    // The snapshot shows the exact `paragraph` ref node containing the text string.
    // Use `evaluate` to look for matching text nodes recursively across the shadow boundaries.
    const foundText = await page.evaluate((searchText) => {
      // Helper to walk DOM including Shadow Roots
      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.includes(searchText)) {
          return true
        }
        if (node.shadowRoot && walk(node.shadowRoot)) {
          return true
        }
        for (let i = 0; i < node.childNodes.length; i++) {
          if (walk(node.childNodes[i])) {
            return true
          }
        }
        return false
      }
      return walk(document.body)
    }, text)

    expect(foundText).toBe(true)
  }).toPass({ timeout: 40000 })
}

const login = async (page, username) => {
  await page.goto('/')

  // Wait for Coralite hydration and component scripts to finish executing
  // @ts-ignore
  await page.waitForFunction(() => window.__coralite_ready__)

  await page.waitForSelector('text=Login to Matrix')
  await page.fill('input[placeholder="Homeserver URL"]', 'http://localhost:6167')
  await page.fill('input[placeholder="Username"]', username)
  await page.fill('input[placeholder="Password"]', 'password123')
  await page.click('button:has-text("Login")')

  // Handle the Unlock Secret Storage / Cross-Signing Modal
  const passwordPrompt = page.locator('.modal-content').filter({ hasText: 'Unlock Secret Storage' }).or(page.locator('.modal-content').filter({ hasText: 'Verify Session' })).or(page.locator('.modal-content').filter({ hasText: 'Security' }))

  try {
    await passwordPrompt.waitFor({
      state: 'visible',
      timeout: 5000
    })
    await passwordPrompt.locator('input[type="password"]').fill('password123')
    await passwordPrompt.getByRole('button', { name: 'Unlock' }).click()
  } catch (error) {
    // If it doesn't appear, ignore and continue
  }

  await expect(page.locator('h5').filter({ hasText: 'Chats' })).toBeVisible()
}
test('Alice creates a room, invites Bob, Bob invites Charlie, all see history', async ({ browser }) => {
  test.setTimeout(120000)

  // ============================================================
  // 1. INITIALIZATION PHASE: Everyone logs in to create their devices
  // ============================================================

  // --- Setup Alice ---
  const aliceContext = await browser.newContext()
  const alicePage = await aliceContext.newPage()
  await login(alicePage, 'alice')

  // --- Setup Bob ---
  const bobContext = await browser.newContext()
  const bobPage = await bobContext.newPage()
  await login(bobPage, 'bob')

  // --- Setup Charlie ---
  const charlieContext = await browser.newContext()
  const charliePage = await charlieContext.newPage()
  await login(charliePage, 'charlie')

  // ============================================================
  // 2. ACTION PHASE: Creating rooms and inviting now that devices exist
  // ============================================================

  await alicePage.bringToFront()

  // Alice creates a room
  await alicePage.getByRole('button', { name: 'New Room' }).click()
  const nameInput = alicePage.locator('input[name="name"]').first()
  await nameInput.waitFor({
    state: 'visible',
    timeout: 5000
  })
  await nameInput.fill('The Hangout')
  const createButton = alicePage.getByRole('button', {
    name: 'Create',
    exact: true
  })
  await createButton.waitFor({
    state: 'visible',
    timeout: 5000
  })
  await createButton.click()
  await alicePage.waitForTimeout(2000)

  // Explicitly click close to work around the form submit issue keeping the modal open in headless playwright
  try {
    await expect(alicePage.locator('.modal-backdrop')).toHaveCount(0, { timeout: 10000 })
  } catch (error) {
    const closeBtn = alicePage.locator('form .btn-close')
    if (await closeBtn.isVisible()) {
      await closeBtn.click()
    }
  }

  // Wait for the modal to close and the room to be created and selected
  await expect(alicePage.locator('.modal-backdrop')).toHaveCount(0, { timeout: 10000 })

  // Wait for room to appear in the list and click it
  await expect(alicePage.locator('.list-group-item').filter({ hasText: 'The Hangout' }).first()).toBeVisible({ timeout: 15000 })
  await alicePage.locator('.list-group-item').filter({ hasText: 'The Hangout' }).first().click()

  // Alice invites Bob immediately
  await alicePage.locator('button').filter({ has: alicePage.locator('i.bi-person-plus') }).first().click()
  await alicePage.fill('input[id*="inviteUserIdInput"]', '@bob:localhost')
  await alicePage.getByRole('button', { name: 'Send Invite' }).click()

  // Wait for invite UI to close
  await expect(alicePage.locator('.modal-backdrop')).toHaveCount(0)

  // --- Bob's Turn ---
  await bobPage.bringToFront()

  // Bob waits for the invite/room to appear in his list
  await expect(bobPage.locator('.list-group-item').filter({ hasText: 'The Hangout' }).first()).toBeVisible({ timeout: 15000 })
  await bobPage.locator('.list-group-item').filter({ hasText: 'The Hangout' }).first().click()

  // Bob joins the room
  await bobPage.getByRole('button', { name: 'Join' }).click()

  // Wait for Bob's client to confirm join state visually before inviting
  await expect(bobPage.locator('input[placeholder="Aa"]')).toBeVisible({ timeout: 15000 })

  // Bob invites Charlie immediately
  await bobPage.locator('button').filter({ has: bobPage.locator('i.bi-person-plus') }).first().click()
  await bobPage.fill('input[id*="inviteUserIdInput"]', '@charlie:localhost')
  await bobPage.getByRole('button', { name: 'Send Invite' }).click()

  await expect(bobPage.locator('.modal-backdrop')).toHaveCount(0)

  // --- Charlie's Turn ---
  await charliePage.bringToFront()

  // Charlie waits for the invite/room to appear
  await expect(charliePage.locator('.list-group-item').filter({ hasText: 'The Hangout' }).first()).toBeVisible({ timeout: 15000 })
  await charliePage.locator('.list-group-item').filter({ hasText: 'The Hangout' }).first().click()

  // Charlie joins the room
  await charliePage.getByRole('button', { name: 'Join' }).click()

  await expect(charliePage.locator('input[placeholder="Aa"]')).toBeVisible({ timeout: 15000 })

  // ============================================================
  // 3. MESSAGING PHASE: Everyone is in the room, start talking
  // ============================================================

  // Now that everyone is in the room, Alice sends the first message
  await alicePage.bringToFront()
  const aliceInput = alicePage.locator('input[placeholder="Aa"]')
  await expect(aliceInput).toBeVisible()
  await aliceInput.fill('Welcome to the hangout!')
  await expect(alicePage.getByRole('button', { name: 'Send Message' })).toBeVisible()
  await alicePage.getByRole('button', { name: 'Send Message' }).click()

  // Verify Alice sees her own message
  await verifyMessageReceived(alicePage, 'Welcome to the hangout!')

  // Bob verifies the history
  await bobPage.bringToFront()
  await verifyMessageReceived(bobPage, 'Welcome to the hangout!')

  // Bob responds
  const bobInput = bobPage.locator('input[placeholder="Aa"]')
  await expect(bobInput).toBeVisible()
  await bobInput.fill('Thanks Alice, glad to be here!')
  await expect(bobPage.getByRole('button', { name: 'Send Message' })).toBeVisible()
  await bobPage.getByRole('button', { name: 'Send Message' }).click()

  // Charlie verifies both messages
  await charliePage.bringToFront()
  await verifyMessageReceived(charliePage, 'Welcome to the hangout!')
  await verifyMessageReceived(charliePage, 'Thanks Alice, glad to be here!')

  // Charlie sends a message
  const charlieInput = charliePage.locator('input[placeholder="Aa"]')
  await expect(charlieInput).toBeVisible()
  await charlieInput.fill('Hey everyone, thanks for the invite!')
  await expect(charliePage.getByRole('button', { name: 'Send Message' })).toBeVisible()
  await charliePage.getByRole('button', { name: 'Send Message' }).click()

  // Verify Alice sees everyone's messages
  await alicePage.bringToFront()
  await verifyMessageReceived(alicePage, 'Thanks Alice, glad to be here!')
  await verifyMessageReceived(alicePage, 'Hey everyone, thanks for the invite!')
})
