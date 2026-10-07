import { test, expect } from '@playwright/test'

test.use({ video: 'on' })

async function setupAuthenticatedPage(page, locale = 'en') {
  page.on('console', (msg) => console.log('BROWSER LOG:', msg.type(), msg.text()))
  page.on('pageerror', (err) => console.log('BROWSER PAGE ERROR:', err))

  await page.route('**/app.html', async (route) => {
    const response = await route.fetch()
    let body = await response.text()
    body = body.replace(/script-src\s/g, "script-src 'wasm-unsafe-eval' ")
    await route.fulfill({
      response,
      body,
      headers: {
        ...response.headers(),
        'content-type': 'text/html'
      }
    })
  })

  await page.goto('/index.html')
  await page.evaluate(({ loc }) => {
    localStorage.setItem('atoll.session.token', 'test-session-token')
    localStorage.setItem('atoll.session.username', 'alice')
    localStorage.setItem('atoll.preference.locale', loc)
  }, { loc: locale })

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'u_alice',
        username_token: 'alice_token',
        encrypted_display: null,
        identity_pubkey: 'pubkey_alice',
        profile: null,
        profile_version: 1,
        created_at: new Date().toISOString()
      })
    })
  )

  await page.route('**/api/v1/users/me/sync*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        max_seq: 0,
        full_resync_required: false,
        read_state: [],
        device_state: [],
        starred_items: []
      })
    })
  )

  await page.route('**/api/v1/oprf/blind', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        evaluated: 'SNMQYGSk2i4CM3QrPyvxt16TpA6QIek10OntpdZ2fDY='
      })
    })
  )
}

test.describe('Conversation List Component Tests', () => {
  test('1. Empty state renders correctly when no rooms exist', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html')

    const chatsView = page.locator('[data-testid="chats"]')
    await expect(chatsView).toBeVisible()

    const emptyTitle = chatsView.locator('.chats__empty-title')
    await expect(emptyTitle).toHaveText('No chats yet')

    const emptyBody = chatsView.locator('.chats__empty-body')
    await expect(emptyBody).toHaveText('Create a room or join with an invite link.')

    await page.screenshot({ path: 'test-results/chats-empty.png', fullPage: true })
  })

  test('2. Room rows render, draft preview shows, and unread dot displays', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html')

    await page.waitForFunction(() => typeof window.__seedTestStorage__ === 'function')

    await page.evaluate(async () => {
      await window.__seedTestStorage__({
        clear: true,
        users: [
          { userId: 'u_alice', displayName: 'Alice' },
          { userId: 'u_bob', displayName: 'Bob' },
          { userId: 'u_charlie', displayName: 'Charlie' }
        ],
        rooms: [
          { roomId: 'r_1', name: 'Design Team' },
          { roomId: 'r_2', name: '' },
          { roomId: 'r_3', name: '' }
        ],
        roomMembers: [
          { roomId: 'r_1', userId: 'u_alice', role: 'member', joinedAt: 1000 },
          { roomId: 'r_1', userId: 'u_bob', role: 'member', joinedAt: 1000 },
          { roomId: 'r_2', userId: 'u_alice', role: 'member', joinedAt: 1000 },
          { roomId: 'r_2', userId: 'u_bob', role: 'member', joinedAt: 1000 },
          { roomId: 'r_3', userId: 'u_alice', role: 'member', joinedAt: 1000 },
          { roomId: 'r_3', userId: 'u_bob', role: 'member', joinedAt: 1000 },
          { roomId: 'r_3', userId: 'u_charlie', role: 'member', joinedAt: 1000 }
        ],
        orderRows: ['r_1', 'r_2', 'r_3'],
        messages: [
          {
            messageId: 'm_1',
            roomId: 'r_1',
            senderUserId: 'u_bob',
            contentType: 'application',
            epoch: 0,
            seq: 1,
            decryptedPayload: JSON.stringify({ type: 'text', text: 'Hey team!' }),
            createdAt: Date.now() - 300000
          },
          {
            messageId: 'm_2',
            roomId: 'r_2',
            senderUserId: 'u_bob',
            contentType: 'application',
            epoch: 0,
            seq: 2,
            decryptedPayload: JSON.stringify({ type: 'text', text: 'See you tomorrow' }),
            createdAt: Date.now() - 60000
          }
        ],
        readStates: [
          { userId: 'u_alice', roomId: 'r_2', lastReadMessageId: 'm_2', lastReadAt: Date.now() }
        ],
        drafts: [
          { roomId: 'r_1', text: 'Draft response to Bob' }
        ]
      })
    })

    const rows = page.locator('conversation-row')
    await expect(rows).toHaveCount(3)

    const row1 = rows.nth(0)
    await expect(row1.locator('.row__name')).toHaveText('Design Team')
    await expect(row1.locator('.row__snippet')).toHaveText('Draft response to Bob')
    await expect(row1).toHaveAttribute('is-unread', '')

    const row2 = rows.nth(1)
    await expect(row2.locator('.row__name')).toHaveText('Bob')
    await expect(row2.locator('.row__snippet')).toHaveText('Bob: See you tomorrow')
    await expect(row2).not.toHaveAttribute('is-unread')

    const row3 = rows.nth(2)
    await expect(row3.locator('.row__name')).toHaveText('Bob, Charlie')

    await page.screenshot({ path: 'test-results/chats-populated.png', fullPage: true })
  })

  test('3. Clicking a conversation row navigates to detail route', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html')

    await page.waitForFunction(() => typeof window.__seedTestStorage__ === 'function')

    await page.evaluate(async () => {
      await window.__seedTestStorage__({
        clear: true,
        rooms: [{ roomId: 'r_test_nav', name: 'Navigation Test Room' }]
      })
    })

    const row = page.locator('conversation-row').first()
    await expect(row).toBeVisible()
    await row.click()

    await expect(page).toHaveURL(/rail=core\.chat&detail=chat&id=r_test_nav/)
  })

  test('4. Empty state respects locale preferences (French)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page, 'fr')
    await page.goto('/app.html')

    const chatsView = page.locator('[data-testid="chats"]')
    await expect(chatsView).toBeVisible()

    const emptyTitle = chatsView.locator('.chats__empty-title')
    await expect(emptyTitle).toHaveText('Aucune discussion pour le moment')

    const emptyBody = chatsView.locator('.chats__empty-body')
    await expect(emptyBody).toHaveText('Créez un salon ou rejoignez-en un avec un lien d’invitation.')
  })
})
