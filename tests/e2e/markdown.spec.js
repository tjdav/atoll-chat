import { test, expect } from './fixtures/base-test.js'

test.describe('Markdown', () => {
  test('should render comprehensive markdown with good contrast and handle link previews', async ({ browser, loginCustomPage }) => {
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

    console.log('Testing Comprehensive Markdown rendering...')
    const markdownText = `# Header 1
## Header 2
**bold** and *italic* and ~~strikethrough~~

- List item 1
- List item 2
  - Nested item

1. Numbered 1
2. Numbered 2

> This is a blockquote
> with multiple lines

\`inline code\`

\`\`\`javascript
// A code block
function hello() {
  console.log("Hello, world!");
}
\`\`\`

| Table | Header |
|-------|--------|
| Row 1 | Val 1  |
| Row 2 | Val 2  |

[Google](https://google.com)`

    await alicePage.fill('textarea[placeholder="Type a message..."]', markdownText)
    await alicePage.click('[data-testid$="__sendButton"]')

    const messageRow = alicePage.locator('timeline-row').filter({ hasText: 'Header 1' })
    await expect(messageRow).toBeVisible()
    await expect(messageRow.locator('h1')).toHaveText('Header 1')
    await expect(messageRow.locator('h2')).toHaveText('Header 2')
    await expect(messageRow.locator('strong')).toHaveText('bold')
    await expect(messageRow.locator('em')).toHaveText('italic')
    await expect(messageRow.locator('del')).toHaveText('strikethrough')
    await expect(messageRow.locator('li').first()).toHaveText('List item 1')
    await expect(messageRow.locator('blockquote')).toContainText('This is a blockquote')
    await expect(messageRow.locator('code').first()).toHaveText('inline code')
    await expect(messageRow.locator('pre code')).toContainText('console.log')
    await expect(messageRow.locator('table')).toBeVisible()
    await expect(messageRow.locator('a:has-text("Google")')).toBeVisible()

    console.log('Testing contrast in Light and Dark mode...')
    // Screenshots for manual verification (handled by Playwright artifacts usually, but we take them for Jules' verification)
    await alicePage.screenshot({ path: 'tests/e2e/screenshots/markdown_light.png' })

    await alicePage.evaluate("document.documentElement.setAttribute('data-bs-theme', 'dark')")
    await alicePage.waitForTimeout(500)
    await alicePage.screenshot({ path: 'tests/e2e/screenshots/markdown_dark.png' })

    // Reset to light for remaining tests
    await alicePage.evaluate("document.documentElement.setAttribute('data-bs-theme', 'light')")

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
