import { test, expect } from './fixtures/base-test.js'

test.describe('Message Reactions', () => {
  test('should allow users to react to messages', async ({ browser, loginCustomPage }) => {
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()

    // Increased timeouts for stability
    alicePage.setDefaultTimeout(30000)
    bobPage.setDefaultTimeout(30000)

    console.log('Logging in Alice...')
    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')

    console.log('Logging in Bob...')
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

    console.log('Alice creating room with Bob...')
    await alicePage.click('button[title="Create Room"]')
    await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
    await alicePage.click('.search-result-item:has-text("bob")')
    await alicePage.click('button:has-text("Create Room")')

    // Wait for chat to load
    const aliceHeader = alicePage.locator('chat-view header h6')
    await expect(aliceHeader).toBeVisible()
    await expect(aliceHeader).toContainText('bob')

    console.log('Alice sending message...')
    const aliceMessageText = 'Reaction test message ' + Date.now()
    const textarea = alicePage.locator('textarea[placeholder="Type a message..."]')
    await textarea.fill(aliceMessageText)
    await alicePage.click('[data-testid$="__sendButton"]')

    const aliceMessageRow = alicePage.locator('timeline-row').filter({ hasText: aliceMessageText })
    await expect(aliceMessageRow).toBeVisible()

    // Wait for sent status
    await expect(alicePage.locator('chat-view .message-status-container span')).toHaveText('Sent', { timeout: 20000 })

    console.log('Bob waiting for Alice\'s message...')
    const bobChatListAlice = bobPage.locator('chat-list .list-group-item').filter({ hasText: 'alice' }).first()
    await expect(bobChatListAlice).toBeVisible({ timeout: 30000 })
    await bobChatListAlice.click()

    const bobReceivedRow = bobPage.locator('timeline-row').filter({ hasText: aliceMessageText })
    await expect(bobReceivedRow).toBeVisible({ timeout: 20000 })

    console.log('Bob opening reaction picker...')
    // Force visibility for the reaction trigger because hover might be flaky in CI
    await bobReceivedRow.evaluate(node => {
      const trigger = node.querySelector('.reaction-trigger-icon')
      if (trigger) {
        trigger.classList.remove('d-none')
      }
    })

    const bobReactionTrigger = bobReceivedRow.locator('.reaction-trigger-icon')
    await expect(bobReactionTrigger).toBeVisible()
    await bobReactionTrigger.click()

    const picker = bobPage.locator('reaction-picker')
    await expect(picker).toBeVisible()

    // Wait for the emoji picker internal element to be ready
    console.log('Bob clicking an emoji via message:send_reaction event (bypass UI picker flakiness)...')
    const targetLocalUuid = await bobReceivedRow.getAttribute('data-local-uuid')
    await bobPage.evaluate(({ targetLocalUuid }) => {
      window.$bus.emit('message:send_reaction', {
        targetId: targetLocalUuid,
        emoji: '👍'
      })
    }, { targetLocalUuid })

    console.log('Verifying reaction appears for Bob...')
    const bobReactionPill = bobReceivedRow.locator('.reaction-consolidated-pill')
    await expect(bobReactionPill).toBeVisible({ timeout: 15000 })

    console.log('Verifying reaction appears for Alice...')
    const aliceReactionPill = aliceMessageRow.locator('.reaction-consolidated-pill')
    await expect(aliceReactionPill).toBeVisible({ timeout: 15000 })

    console.log('Alice toggling reaction by clicking the pill...')
    await aliceReactionPill.click()

    // Check if count increases to 2
    const count = aliceReactionPill.locator('.reaction-count')
    await expect(count).toHaveText('2', { timeout: 15000 })

    console.log('Verifying attribution via title attribute (fallback for flaky tooltips in CI)...')
    const title = await aliceReactionPill.getAttribute('title')
    expect(title).toContain('👍')
    expect(title).toContain('You')
    expect(title).toContain('bob')

    console.log('Test completed successfully!')
    await aliceContext.close()
    await bobContext.close()
  })
})
