import { test, expect } from '@playwright/test'

test.use({ video: 'on' })

async function setupAuthenticatedPage(page, locale = 'en') {
  page.on('console', (msg) => console.log('BROWSER LOG:', msg.type(), msg.text()))
  page.on('pageerror', (err) => console.log('BROWSER PAGE ERROR:', err))

  await page.route('**/app.html*', async (route) => {
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
        id: 'u_me',
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

test.describe('Message Thread Surface Component Tests', () => {
  test('1. Empty thread state renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html?rail=core.chat&detail=chat&id=r_empty')

    const chatView = page.locator('[data-testid="chat"]')
    await expect(chatView).toBeVisible()

    const emptyText = page.locator('.chat__empty')
    await expect(emptyText).toBeVisible()
    await expect(emptyText).toHaveText('This is the beginning of the room.')

    await page.screenshot({ path: 'test-results/chat-empty.png', fullPage: true })
  })

  test('2. Populated thread renders bubbles, date separators, new messages divider, and tombstone', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html?rail=core.chat&detail=chat&id=r_1')

    const chatView = page.locator('[data-testid="chat"]')
    await expect(chatView).toBeVisible()

    const bubbles = page.locator('message-bubble')
    await expect(bubbles.first()).toBeVisible()

    const dateSep = page.locator('date-separator')
    await expect(dateSep).toBeVisible()

    const divider = page.locator('.chat__divider')
    await expect(divider).toBeVisible()
    await expect(divider).toHaveText('New messages')

    const tombstone = page.locator('message-bubble[is-tombstone="true"]')
    await expect(tombstone).toBeVisible()

    const pending = page.locator('message-bubble[is-pending="true"]')
    await expect(pending).toBeVisible()

    await page.screenshot({ path: 'test-results/chat-populated.png', fullPage: true })
  })

  test('3. Scrolling up triggers scroll-to-bottom button and clicking it scrolls back to bottom', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html?rail=core.chat&detail=chat&id=r_1')

    const thread = page.locator('[data-testid="thread"]')
    await expect(thread).toBeVisible()

    await thread.evaluate((el) => {
      el.scrollTop = el.scrollTop - 1000
    })

    const scrollBtn = page.locator('[data-testid="scroll-to-bottom"]')
    await expect(scrollBtn).toBeVisible()

    await scrollBtn.click()

    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="thread"]')
      if (!el) return false
      return el.scrollHeight - el.scrollTop - el.clientHeight <= 80
    })
  })

  test('4. Empty thread respects French locale', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page, 'fr')
    await page.goto('/app.html?rail=core.chat&detail=chat&id=r_empty')

    const emptyText = page.locator('.chat__empty')
    await expect(emptyText).toBeVisible()
    await expect(emptyText).toHaveText('C’est le début du salon.')
  })
})
