import { test, expect } from './fixtures/base-test.js'

test.describe('Chat List Anti-Duplication', () => {
  test('should not duplicate chat items during rapid updates', async ({ browser, loginCustomPage }) => {
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()

    console.log('Logging in Alice and Bob...')
    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

    // Alice creates a room with Bob
    await alicePage.click('button[title="Create Room"]')
    await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
    await alicePage.click('.search-result-item:has-text("bob")')
    await alicePage.click('button:has-text("Create Room")')
    await expect(alicePage.locator('chat-view header h6')).toContainText('bob')

    const roomId = await alicePage.evaluate(() => window.$state.activeSelectionId)
    console.log('Room created with ID:', roomId)

    // Bob sees the room
    const bobChatListAlice = bobPage.locator('chat-list .app-list-item').filter({ hasText: 'alice' })
    await expect(bobChatListAlice).toBeVisible({ timeout: 15000 })

    console.log('Simulating rapid updates for the same room on Bob\'s page...')
    // We use evaluate to emit multiple rapid events on Bob's page
    await bobPage.evaluate((rid) => {
      // Emit 10 rapid updates
      for (let i = 0; i < 10; i++) {
        window.$bus.emit('db:new_local_data', { room_id: rid })
      }
    }, roomId)

    // Give it a moment to process (though it's debounced/guarded)
    await bobPage.waitForTimeout(1000)

    // Verify Bob only has ONE item for Alice
    const count = await bobChatListAlice.count()
    console.log('Bob Alice chat item count:', count)
    expect(count).toBe(1)

    console.log('Simulating rapid sync:complete events...')
    await bobPage.evaluate(() => {
      for (let i = 0; i < 5; i++) {
        window.$bus.emit('sync:complete')
      }
    })

    await bobPage.waitForTimeout(1000)
    const finalCount = await bobChatListAlice.count()
    console.log('Bob Alice chat item count after sync:', finalCount)
    expect(finalCount).toBe(1)

    await aliceContext.close()
    await bobContext.close()
  })
})
