import { test, expect } from './fixtures/base-test.js'

test.describe('Anti-Duplication & Optimistic UI', () => {
  test('should show optimistic UI and prevent duplicates', async ({ page, loginApp }) => {
    // 1. Login
    await loginApp('alice', 'Password123!', '123456')

    // 2. Create/Open a room (e.g., with Bob)
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')
    await expect(page.locator('chat-view header h6')).toContainText('bob')

    // 3. Send a message and check for optimistic state
    const messageText = 'Optimistic Test ' + Date.now()
    const textarea = page.locator('[data-testid="chat-input-wrapper"] textarea')
    await textarea.waitFor({ state: 'visible' })
    await textarea.fill(messageText)

    // We want to catch the "pending" state.
    // Since the worker might be fast, we'll click and immediately look for the placeholder.
    await page.click('button:has-text("Send")')

    const messageBubble = page.locator('[data-cid="text-message-0"]')
    // Check if it's there (optimistic UI)
    await expect(messageBubble).toBeVisible()

    await expect(messageBubble).toContainText('Optimistic Test')

    // 4. Verify no duplicates
    const count = await messageBubble.count()
    expect(count).toBe(1)

    // 5. Verify IndexedDB state (optional but good)
    const dbState = await page.evaluate(async (text) => {
      // 1. Safely get the native database instance
      let nativeDB

      if (window.AtollChatDB) {
        // If it's a Dexie instance, it has a backendDB() method to get the native DB.
        // Otherwise, assume it's already the native DB.
        nativeDB = typeof window.AtollChatDB.backendDB === 'function'
          ? window.AtollChatDB.backendDB()
          : window.AtollChatDB
      } else {
        // Open native IndexedDB
        nativeDB = await new Promise((resolve, reject) => {
          const request = indexedDB.open('AtollChatDB')
          request.onsuccess = (event) => resolve(event.target.result)
          request.onerror = (event) => reject(event.target.error)
        })

        // Cache it
        window.AtollChatDB = nativeDB
      }

      // 2. Query the data using the native database
      const result = await new Promise((resolve, reject) => {
        // Now we know nativeDB is a standard IDBDatabase
        const transaction = nativeDB.transaction('local_messages', 'readonly')
        const store = transaction.objectStore('local_messages')

        const index = store.index('content')
        const getRequest = index.get(text)

        getRequest.onsuccess = (event) => {
          resolve(event.target.result)
        }

        getRequest.onerror = (event) => {
          reject(event.target.error)
        }
      })

      return result
    }, messageText)

    expect(dbState).toBeDefined()
    expect(dbState.status).toBe('sent')
    expect(dbState.local_uuid).toBeDefined()
    expect(dbState.id).not.toBeNull()
  })
})
