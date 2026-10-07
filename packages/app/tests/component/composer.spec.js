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

test('composer component interactive flows', async ({ page }) => {
  await setupAuthenticatedPage(page)
  await page.goto('/app.html?rail=core.chat&detail=chat&id=r_1')

  const composer = page.locator('message-composer')
  await expect(composer).toBeVisible()

  const sendBtn = composer.locator('.composer__btn--send')
  const textarea = composer.locator('textarea')

  // 1. Empty composer disables send
  await expect(sendBtn).toBeDisabled()

  // 2. Typing enables send
  await textarea.fill('Hello world')
  await expect(composer).toHaveAttribute('has-text', '')
  await expect(sendBtn).toBeEnabled()

  // 3. Shift+Enter inserts newline without sending
  await textarea.fill('line1')
  await textarea.press('Shift+Enter')
  await textarea.type('line2')
  await expect(textarea).toHaveValue('line1\nline2')

  // 4. Click stub buttons
  await composer.locator('.composer__btn--attach').click({ force: true })
  await composer.locator('.composer__btn--emoji').click({ force: true })
  await composer.locator('.composer__btn--speak').click({ force: true })

  // 5. Enter sends message
  await textarea.fill('Hello from composer test')
  await textarea.press('Enter')
  await expect(textarea).toHaveValue('')

  await page.screenshot({ path: 'test-results/composer-pending.png', fullPage: true })
})
