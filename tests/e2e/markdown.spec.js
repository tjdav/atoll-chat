import { test, expect } from './fixtures/base-test.js'

test.describe('Markdown', () => {
  test('should render markdown and handle link previews', async ({ browser, loginCustomPage }) => {
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()

    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')

    console.log('Alice creating room with Bob...')
    await alicePage.click('button[title="Create Room"]')
    await expect(alicePage.locator('.modal-title:has-text("Create New Room")')).toBeVisible()

    await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
    await alicePage.click('.search-result-item:has-text("bob")')
    await alicePage.click('button:has-text("Create Room")')

    // Wait for chat to open for Alice
    await expect(alicePage.locator('chat-view')).toBeVisible()

    console.log('Testing Markdown rendering...')
    const markdownText = '# Header\n**bold** and *italic*\n- list item'
    await alicePage.fill('textarea[placeholder="Type a message..."]', markdownText)
    await alicePage.click('[data-testid$="__sendButton"]')

    const messageRow = alicePage.locator('timeline-row').filter({ hasText: 'Header' })
    await expect(messageRow).toBeVisible()
    await expect(messageRow.locator('h1')).toHaveText('Header')
    await expect(messageRow.locator('strong')).toHaveText('bold')
    await expect(messageRow.locator('em')).toHaveText('italic')
    await expect(messageRow.locator('li')).toHaveText('list item')

    console.log('Testing Markdown link preview...')
    await alicePage.fill('textarea[placeholder="Type a message..."]', '[Google](https://google.com)')

    // Wait for link preview to appear
    const preview = alicePage.locator('link-preview-input')
    await expect(preview).toBeVisible({ timeout: 15000 })
    await expect(preview.locator('.fw-bold')).toContainText('Google')

    console.log('Markdown verification successful!')
    await aliceContext.close()
  })
})
