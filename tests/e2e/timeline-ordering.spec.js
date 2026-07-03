import { test, expect } from './fixtures/base-test.js'

test.describe('Timeline Ordering', () => {
  test('Call status messages and text messages are correctly ordered and not duplicated', async ({ page, loginApp }) => {
    test.setTimeout(60000)

    // Setup and Login
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Open a chat with Bob
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')
    await expect(page.locator('chat-view header h6')).toContainText('bob', { ignoreCase: true })

    // Inject messages via console
    // We'll inject out-of-order to test the sorting: Newer Text then Older Call
    await page.evaluate(async () => {
      const $state = window.$state
      const $localDb = window.$localDb
      const $bus = window.$bus

      const roomId = $state.activeSelectionId
      if (!roomId) {
        throw new Error('No active room')
      }

      const now = Date.now()
      const tCall = new Date(now - 10000).toISOString()
      const tText = new Date(now - 5000).toISOString()

      const textMsg = {
        local_uuid: 'e2e-text-1',
        room_id: roomId,
        sender_id: $state.currentUser.id,
        type: 'text',
        content: 'I am the newer message',
        created_at: tText,
        status: 'sent'
      }

      const callMsg = {
        local_uuid: 'e2e-call-1',
        room_id: roomId,
        sender_id: $state.currentUser.id,
        type: 'call_offer',
        content: {},
        created_at: tCall,
        status: 'sent'
      }

      // Inject NEWER text first
      await $localDb.local_messages.put(textMsg)
      $bus.emit('db:new_local_data', {
        room_id: roomId,
        message: textMsg
      })

      await new Promise(r => setTimeout(r, 500))

      // Inject OLDER call second - Sorting should put it ABOVE the text message
      await $localDb.local_messages.put(callMsg)
      $bus.emit('db:new_local_data', {
        room_id: roomId,
        message: callMsg
      })
    })

    // Verify Order in DOM
    const timeline = page.locator('message-timeline')

    const callStatus = timeline.locator('timeline-system-message[data-local-uuid="e2e-call-1"]')
    const textMessage = timeline.locator('timeline-row[data-local-uuid="e2e-text-1"]')

    await expect(callStatus).toBeVisible({ timeout: 20000 })
    await expect(textMessage).toBeVisible({ timeout: 20000 })

    const isOrdered = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('timeline-row, timeline-system-message'))
      const callIdx = elements.findIndex(el => el.getAttribute('data-local-uuid') === 'e2e-call-1')
      const textIdx = elements.findIndex(el => el.getAttribute('data-local-uuid') === 'e2e-text-1')
      return {
        callIdx,
        textIdx,
        ordered: callIdx !== -1 && textIdx !== -1 && callIdx < textIdx
      }
    })

    expect(isOrdered.ordered).toBe(true)

    // 5. Verify No Duplication
    await page.fill('chat-input-text [contenteditable]', 'Another message')
    await page.keyboard.press('Enter')

    await expect(page.locator('timeline-row:has-text("Another message")')).toBeVisible()

    await expect(callStatus).toHaveCount(1)
  })
})
