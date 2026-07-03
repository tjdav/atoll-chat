import { test, expect } from './fixtures/base-test.js'

test.describe('Notification Sounds', () => {
  test('should debounce notification sounds for rapid messages', async ({ browser, loginCustomPage }) => {
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()

    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()

    // Setup Mock for Audio.play on Alice's page
    await alicePage.addInitScript(() => {
      window.playCount = 0
      const originalAudio = window.Audio
      window.Audio = class extends originalAudio {
        play () {
          window.playCount++
          return Promise.resolve()
        }
      }
    })

    // Login Alice and Bob
    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

    // Bob ensures a room with Alice exists and sends messages
    const chatListAlice = bobPage.locator('.chat-list-item:has-text("alice")').first()
    // If Alice is not in the list, Bob creates a room
    if (!(await chatListAlice.isVisible())) {
      await bobPage.click('button[title="Create Room"]')
      await bobPage.fill('input[placeholder="Search by username..."]', 'alice')
      await bobPage.click('.search-result-item:has-text("alice")')
      await bobPage.click('button:has-text("Create Room")')
    } else {
      await chatListAlice.click()
    }

    await bobPage.waitForSelector('chat-input-text textarea')

    // Alice should not be looking at Bob's chat to trigger sounds
    // Since she just logged in, her activeSelectionId should be null or something else.

    // Bob sends 3 messages rapidly
    const textarea = bobPage.locator('chat-input-text textarea')
    await textarea.fill('Message 1')
    await bobPage.keyboard.press('Enter')
    await textarea.fill('Message 2')
    await bobPage.keyboard.press('Enter')
    await textarea.fill('Message 3')
    await bobPage.keyboard.press('Enter')

    // Verify Alice only played sound once due to debounce
    // Wait a bit for messages to arrive and play
    await alicePage.waitForTimeout(2000)

    const playCount = await alicePage.evaluate(() => window.playCount)
    expect(playCount).toBe(1)

    await aliceContext.close()
    await bobContext.close()
  })

  test('should suppress notification sounds during catch-up', async ({ browser, loginCustomPage }) => {
    // Bob logs in and sends messages to Alice while she is offline
    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

    const chatListAlice = bobPage.locator('.chat-list-item:has-text("alice")').first()
    if (!(await chatListAlice.isVisible())) {
      await bobPage.click('button[title="Create Room"]')
      await bobPage.fill('input[placeholder="Search by username..."]', 'alice')
      await bobPage.click('.search-result-item:has-text("alice")')
      await bobPage.click('button:has-text("Create Room")')
    } else {
      await chatListAlice.click()
    }
    await bobPage.waitForSelector('chat-input-text textarea')

    const textarea = bobPage.locator('chat-input-text textarea')
    await textarea.fill('Backlog Message 1')
    await bobPage.keyboard.press('Enter')
    await textarea.fill('Backlog Message 2')
    await bobPage.keyboard.press('Enter')
    await bobPage.waitForTimeout(1000)

    // Alice logs in
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()

    // Setup Mock for Audio.play on Alice's page BEFORE login/sync
    await alicePage.addInitScript(() => {
      window.playCount = 0
      const originalAudio = window.Audio
      window.Audio = class extends originalAudio {
        play () {
          window.playCount++
          return Promise.resolve()
        }
      }
    })

    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')

    // Wait for sync to complete
    await alicePage.evaluate(() => {
      return new Promise((resolve) => {
        const check = () => {
          if (window.$bus) {
            // Check if it already finished
            if (window.__sync_complete__) {
              resolve()
              return
            }
            window.$bus.on('sync:complete', () => {
              window.__sync_complete__ = true
              resolve()
            })
          } else {
            setTimeout(check, 100)
          }
        }
        check()
      })
    })

    // Additional buffer
    await alicePage.waitForTimeout(1000)

    const playCount = await alicePage.evaluate(() => window.playCount)
    expect(playCount).toBe(0)

    await aliceContext.close()
    await bobContext.close()
  })
})
