import { test, expect } from './fixtures/base-test.js'

test.describe('Multi-Link Previews', () => {
  test('should detect, render, and navigate multiple links in a single message', async ({ browser, loginCustomPage }) => {
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()

    // Mock link extraction
    await alicePage.route('**/api/link-extraction*', async route => {
      const url = new URL(route.request().url()).searchParams.get('url')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title: `Title for ${url}`,
          description: `Description for ${url}`,
          image: '',
          domain: new URL(url).hostname,
          url: url
        })
      })
    })

    // Login Alice
    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')

    // Create chat with Bob
    await alicePage.click('button[title="Create Room"]')
    await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
    await alicePage.click('.search-result-item:has-text("bob")')
    await alicePage.click('button:has-text("Create Room")')

    await expect(alicePage.locator('chat-view')).toBeVisible()

    // Alice types multiple URLs
    const url1 = 'https://google.com'
    const url2 = 'https://github.com'
    await alicePage.fill('textarea[placeholder="Type a message..."]', `Check these: ${url1} and ${url2} `)

    // Verify multiple live previews appear
    await expect(alicePage.locator('link-preview-input')).toHaveCount(2, { timeout: 15000 })

    // Alice sends the message
    await alicePage.click('[data-testid$="__sendButton"]')

    // Verify multiple link previews in timeline
    const previews = alicePage.locator('link-preview')
    await expect(previews).toHaveCount(2, { timeout: 15000 })

    // Open Link List (Sidebar)
    await alicePage.click('button[title="Links"]')
    const listItems = alicePage.locator('.link-list .app-list-item')
    // Should see 2 entries even though they came from 1 message
    await expect(listItems).toHaveCount(2, { timeout: 5000 })

    // Click any link and verify clean URL
    await listItems.nth(0).click()
    await expect(alicePage.locator('link-viewer')).toBeVisible()

    const visitBtn = alicePage.locator('.carousel-item.active .link-visit-btn')
    const viewerHref = await visitBtn.getAttribute('href')
    // Verify href is CLEAN (not the whole message)
    expect(viewerHref).toMatch(/^https?:\/\//)
    expect(viewerHref).not.toContain('Check these:')

    await aliceContext.close()
  })

  test('should allow dismissing individual links', async ({ page, loginCustomPage }) => {
    // Mock link extraction
    await page.route('**/api/link-extraction*', async route => {
      const url = new URL(route.request().url()).searchParams.get('url')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title: `Title for ${url}`,
          description: `Description for ${url}`,
          image: '',
          domain: 'example.com',
          url: url
        })
      })
    })

    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')

    // Open any chat
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')

    await page.fill('textarea[placeholder="Type a message..."]', 'https://a.com https://b.com ')

    await expect(page.locator('link-preview-input')).toHaveCount(2, { timeout: 10000 })

    // Dismiss first one
    await page.locator('link-preview-input').first().locator('button[title="Dismiss preview"]').click()
    await expect(page.locator('link-preview-input')).toHaveCount(1)

    // Send
    await page.click('[data-testid$="__sendButton"]')

    // Verify only one link preview in timeline
    await expect(page.locator('link-preview')).toHaveCount(1)
  })
})
