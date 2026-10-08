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
