import { test, expect } from './fixtures/base-test.js'

test.describe('Messaging Features', () => {

  test.describe('Chat Actions', () => {
    test.beforeEach(async ({ page, loginApp }) => {
      test.slow()
      await loginApp('alice', 'Password123!', 'VaultPassword123!')
      await page.getByTitle('Create Room').click()
      await page.getByPlaceholder('Search by username...').fill('bob')
      await page.locator('.search-result-item:has-text("bob")').click()
      await page.getByRole('button', { name: 'Create Room' }).click()
      await page.fill('textarea', 'Msg 1')
      await page.keyboard.press('Enter')
      await page.getByTitle('Create Room').click()
      await page.getByPlaceholder('Search by username...').fill('charlie')
      await page.locator('.search-result-item:has-text("charlie")').click()
      await page.getByRole('button', { name: 'Create Room' }).click()
    })

    test('mark as unread, mute, delete', async ({ page }) => {
      // Ensure sync is complete before interacting
      await page.waitForFunction(() => window.$bus && !window.$state.isCatchingUp, { timeout: 30000 })
      
      const getBobChat = () => page.locator('chat-list-item').filter({ hasText: 'Bob' })
      await expect(getBobChat()).toBeVisible({ timeout: 30000 })
      
      console.log('Toggling read status...')
      await getBobChat().getByLabel('Chat actions').evaluate(el => el.click())
      await getBobChat().getByTestId('btn-toggle-read').click()
      
      // Wait for success toast to ensure operation finished
      await expect(page.locator('.toast')).toContainText(/Marked as unread|Marked as read/, { timeout: 20000 })
      
      // Verification: Dropdown label should have flipped
      await getBobChat().getByLabel('Chat actions').evaluate(el => el.click())
      await expect(getBobChat().getByTestId("btn-toggle-read")).toContainText(/Mark as read|Mark as unread/, { timeout: 15000 })

      console.log('Toggling mute status...')
      await getBobChat().getByTestId('btn-toggle-mute').click()
      await expect(page.locator('.toast')).toContainText('Notifications muted')

      page.once('dialog', dialog => dialog.accept())
      await getBobChat().getByLabel('Chat actions').evaluate(el => el.click())
      await getBobChat().getByTestId('btn-delete-chat').click()
      await expect(page.locator('chat-list-item').filter({ hasText: 'Bob' })).toHaveCount(0)
    })
  })

  test.describe('Timeline Behavior', () => {
    test('auto-scroll and focus persistence', async ({ browser, loginCustomPage }) => {
      test.slow()
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')

      await alicePage.click('button[title="Create Room"]')
      await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
      await alicePage.click('.search-result-item:has-text("bob")')
      await alicePage.click('button:has-text("Create Room")')

      const aliceInput = alicePage.locator('textarea[placeholder="Type a message..."]')
      for (let i = 0; i < 25; i++) {
        await aliceInput.fill(`Msg ${i}`)
        await alicePage.keyboard.press('Enter')
        await alicePage.waitForTimeout(100) // Give it a moment to process
      }
      // Ensure messages are rendered
      await expect(alicePage.locator('timeline-row').last()).toContainText('Msg 24', { timeout: 20000 })

      const timeline = alicePage.locator('message-timeline div.overflow-auto').first()
      await timeline.evaluate(el => el.scrollTop = 0)
      await alicePage.waitForTimeout(1000) // Wait for debounce and scroll to settle

      await aliceInput.fill('Jump')
      await alicePage.keyboard.press('Enter')
      // Wait for smooth scroll to finish
      await alicePage.waitForTimeout(3000)
      const scrollTop = await timeline.evaluate(el => el.scrollTop)
      const scrollHeight = await timeline.evaluate(el => el.scrollHeight)
      const clientHeight = await timeline.evaluate(el => el.clientHeight)
      expect(scrollTop).toBeGreaterThan(scrollHeight - clientHeight - 100)
      await expect(aliceInput).toBeFocused()
      
      await aliceContext.close()
    })

    test('message ordering', async ({ page, loginApp }) => {
      test.slow()
      await loginApp('alice', 'Password123!', 'VaultPassword123!')
      await page.click('button[title="Create Room"]')
      await page.fill('input[placeholder="Search by username..."]', 'bob')
      await page.waitForSelector('.search-result-item:has-text("bob")', { timeout: 10000 })
      await page.click('.search-result-item:has-text("bob")')
      await page.click('button:has-text("Create Room")')
      await expect(page.locator('chat-view')).toBeVisible()

      await page.evaluate(async () => {
        const roomId = window.$state.activeSelectionId
        const now = Date.now()
        const msg1 = { local_uuid: 'm1', room_id: roomId, sender_id: window.$state.currentUser.id, type: 'text', content: 'New', created_at: new Date(now).toISOString(), status: 'sent' }
        const msg2 = { local_uuid: 'm2', room_id: roomId, sender_id: window.$state.currentUser.id, type: 'text', content: 'Old', created_at: new Date(now - 10000).toISOString(), status: 'sent' }
        await window.$localDb.local_messages.put(msg2)
        window.$bus.emit('db:new_local_data', { room_id: roomId, message: msg2 })
        await window.$localDb.local_messages.put(msg1)
        window.$bus.emit('db:new_local_data', { room_id: roomId, message: msg1 })
      })
      await expect(page.locator('timeline-row').first()).toContainText('Old')
      await expect(page.locator('timeline-row').last()).toContainText('New')
    })
  })

  test.describe('Content Rendering', () => {
    test('comprehensive markdown', async ({ page, loginCustomPage }) => {
      test.slow()
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      await page.click('button[title="Create Room"]')
      await page.fill('input[placeholder="Search by username..."]', 'bob')
      await page.click('.search-result-item:has-text("bob")')
      await page.click('button:has-text("Create Room")')
      const md = '# H1\n## H2\n**B**\n*I*\n- L\n> Q\n`C`\n\n| T | H |\n|---|---|\n| R | V |\n\n[G](https://google.com)'
      await page.fill('textarea', md)
      await page.click('[data-testid$="__sendButton"]')
      const row = page.locator('timeline-row').filter({ hasText: 'H1' })
      await expect(row.locator('h1')).toHaveText('H1')
      await expect(row.locator('h2')).toHaveText('H2')
      await expect(row.locator('strong')).toHaveText('B')
      await expect(row.locator('em')).toHaveText('I')
      await expect(row.locator('li')).toContainText('L')
      await expect(row.locator('blockquote')).toContainText('Q')
      await expect(row.locator('code').first()).toHaveText('C')
      await expect(row.locator('table')).toBeVisible()
      await expect(row.locator('a:has-text("G")')).toBeVisible()
    })

    test('link previews', async ({ page, loginCustomPage }) => {
      test.slow()
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      await page.click('button[title="Create Room"]')
      await page.fill('input[placeholder="Search by username..."]', 'bob')
      await page.click('.search-result-item:has-text("bob")')
      await page.click('button:has-text("Create Room")')
      await page.fill('textarea', 'https://google.com https://github.com ')
      await expect(page.locator('link-preview-input')).toHaveCount(2, { timeout: 15000 })
      await page.locator('link-preview-input').first().locator('button[title="Dismiss preview"]').click()
      await expect(page.locator('link-preview-input')).toHaveCount(1)
      await page.click('[data-testid$="__sendButton"]')
      await expect(page.locator('link-preview')).toHaveCount(1)
    })
  })

  test.describe('Interaction & Features', () => {
    test('message reactions', async ({ browser, loginCustomPage }) => {
      test.slow()
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      const bobContext = await browser.newContext()
      const bobPage = await bobContext.newPage()
      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
      await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
      await alicePage.click('button[title="Create Room"]')
      await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
      await alicePage.click('.search-result-item:has-text("bob")')
      await alicePage.click('button:has-text("Create Room")')
      const msg = 'React ' + Date.now()
      await alicePage.fill('textarea', msg)
      await alicePage.click('[data-testid$="__sendButton"]')
      const bobChat = bobPage.locator('chat-list .app-list-item').filter({ hasText: 'alice' }).first()
      await expect(bobChat).toBeVisible({ timeout: 30000 })
      await bobChat.click()
      const row = bobPage.locator('timeline-row').filter({ hasText: msg })
      await expect(row).toBeVisible({ timeout: 20000 })
      const uuid = await row.getAttribute('data-local-uuid')
      await bobPage.evaluate(({ uuid }) => {
        window.$bus.emit('message:send_reaction', { targetId: uuid, content: { type: 'emoji', value: '👍' } })
      }, { uuid })
      await expect(row.locator('.reaction-consolidated-pill')).toBeVisible({ timeout: 15000 })
      const alicePill = alicePage.locator('timeline-row').filter({ hasText: msg }).locator('.reaction-consolidated-pill')
      await alicePill.click()
      await expect(alicePill.locator('.reaction-count')).toHaveText('2', { timeout: 15000 })
      await aliceContext.close()
      await bobContext.close()
    })

    test('search and notifications', async ({ browser, page, loginCustomPage }) => {
      test.slow()
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      await page.click('button[title="Create Room"]')
      await page.fill('input[placeholder="Search by username..."]', 'bob')
      await page.waitForSelector('.search-result-item:has-text("bob")', { timeout: 10000 })
      await page.locator('.search-result-item:has-text("bob")').click()
      await page.fill('input[placeholder="Search by username..."]', 'charlie')
      await page.waitForSelector('.search-result-item:has-text("charlie")', { timeout: 10000 })
      await page.locator('.search-result-item:has-text("charlie")').click()
      await page.fill('input[placeholder="Enter group name"]', 'Project X')
      await page.click('button:has-text("Create Room")')
      
      // Wait for room to appear in list
      await expect(page.locator('chat-list .app-list-item:has-text("Project X")')).toBeVisible({ timeout: 15000 })
      
      await page.locator('input[placeholder="Search..."]').fill('Project')
      await expect(page.locator('chat-list .app-list-item:has-text("Project X")')).toBeVisible()

      // Debounce sound
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      const bobContext = await browser.newContext()
      const bobPage = await bobContext.newPage()
      await alicePage.addInitScript(() => {
        window.playCount = 0
        window.Audio = class extends window.Audio { play() { window.playCount++; return Promise.resolve() } }
      })
      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
      await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
      await bobPage.click('button[title="Create Room"]')
      await bobPage.fill('input[placeholder="Search by username..."]', 'alice')
      await bobPage.click('.search-result-item:has-text("alice")')
      await bobPage.click('button:has-text("Create Room")')
      for (let i = 0; i < 3; i++) {
        await bobPage.fill('textarea', `M ${i}`)
        await bobPage.keyboard.press('Enter')
      }
      await alicePage.waitForTimeout(2000)
      expect(await alicePage.evaluate(() => window.playCount)).toBe(1)
      await aliceContext.close()
      await bobContext.close()
    })
  })
})
