/**
 * Playwright helper for loading storage fixture test pages and setting up auth mocks.
 */

/**
 * Loads the given path with a fixture query parameter and waits for fixture completion.
 * @param {import('@playwright/test').Page} page
 * @param {object} [options]
 * @param {string} [options.seed]
 * @param {string} [options.path]
 */
export async function loadWithFixture(page, { seed = 'empty', path = '/app.html' } = {}) {
  const url = new URL(path, 'http://localhost:3000')
  url.searchParams.set('fixture', seed)
  await page.goto(url.toString())
  await page.waitForSelector('html[data-fixture-ready]', { timeout: 15000 })
  const ready = await page.getAttribute('html', 'data-fixture-ready')
  if (ready !== seed) {
    const err = await page.getAttribute('html', 'data-fixture-error')
    throw new Error(`Fixture failed: expected "${seed}", got "${ready}", error: ${err}`)
  }
}

/**
 * Stubs network routes for boot and user session API requests.
 * @param {import('@playwright/test').Page} page
 */
export async function stubAuth(page) {
  await page.route('**/api/v1/users/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: 'u_me', username_token: 'x', encrypted_display: null, identity_pubkey: 'y', profile: null, profile_version: 1, created_at: new Date().toISOString() })
  }))
  await page.route('**/api/v1/oprf/blind', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ evaluated: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
  }))
  await page.route('**/api/v1/users/me/sync**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ read_state: [], user_preferences: [], device_state: [], starred_items: [], max_seq: 0, full_resync_required: false })
  }))
}

/**
 * Seeds localStorage session tokens for authenticated page loads.
 * @param {import('@playwright/test').Page} page
 */
export async function seedSession(page) {
  await page.goto('/index.html')
  await page.evaluate(() => {
    localStorage.setItem('atoll.session.token', 'test-token')
    localStorage.setItem('atoll.session.username', 'alice')
  })
}

/**
 * Mounts a <ui-sheet> element into the DOM with specified attributes and slotted body content.
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, string | boolean>} [attrs]
 */
export async function mountSheet(page, attrs = {}) {
  await page.evaluate((attrs) => {
    const existing = document.querySelector('#cv-sheet-test')
    if (existing) existing.remove()
    const sheet = document.createElement('ui-sheet')
    for (const [k, v] of Object.entries(attrs)) {
      if (typeof v === 'boolean') {
        if (v) sheet.setAttribute(k, '')
        else sheet.removeAttribute(k)
      } else {
        sheet.setAttribute(k, String(v))
      }
    }
    sheet.id = 'cv-sheet-test'
    const body = document.createElement('div')
    body.setAttribute('data-testid', 'sheet-body')
    body.textContent = 'Sheet body content'
    sheet.appendChild(body)
    document.body.appendChild(sheet)
  }, attrs)
}

/**
 * Updates the `open` attribute on the mounted test sheet.
 * @param {import('@playwright/test').Page} page
 * @param {boolean} open
 */
export async function setSheetOpen(page, open) {
  await page.evaluate((open) => {
    const sheet = document.querySelector('#cv-sheet-test')
    if (!sheet) throw new Error('Sheet not mounted')
    if (open) {
      sheet.setAttribute('open', '')
    } else {
      sheet.removeAttribute('open')
    }
  }, open)
}

/**
 * Installs a window event listener to record `sheet:close` events.
 * @param {import('@playwright/test').Page} page
 */
export async function recordSheetEvents(page) {
  await page.evaluate(() => {
    window.__cvSheetLastClose = null
    document.addEventListener('sheet:close', () => {
      window.__cvSheetLastClose = { at: Date.now() }
    })
  })
}

/**
 * Retrieves the last recorded `sheet:close` event detail from window scope.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ at: number } | null>}
 */
export async function getLastSheetCloseEvent(page) {
  return page.evaluate(() => window.__cvSheetLastClose ?? null)
}
