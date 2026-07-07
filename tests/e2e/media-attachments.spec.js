import { test, expect } from './fixtures/base-test.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test.describe('Media & Attachments', () => {

  test.describe('File Handling', () => {
    test('send various file types', async ({ browser, loginCustomPage }) => {
      test.setTimeout(120000)
      const aliceContext = await browser.newContext()
      const alicePage = await aliceContext.newPage()
      const bobContext = await browser.newContext()
      const bobPage = await bobContext.newPage()
      await Promise.all([
        loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!'),
        loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
      ])
      await alicePage.click('button[title="Create Room"]')
      await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
      await alicePage.click('.search-result-item:has-text("bob")')
      await alicePage.click('button:has-text("Create Room")')
      const bobChat = bobPage.locator('chat-list .app-list-item').filter({ hasText: 'alice' }).first()
      await expect(bobChat).toBeVisible({ timeout: 30000 })
      await bobChat.click()

      const files = [
        {
          n: 'test.png',
          s: 'media-preview img',
          tid: '__imageInput'
        },
        {
          n: 'test.mp4',
          s: 'media-preview video',
          tid: '__videoInput'
        },
        {
          n: 'test.docx',
          s: 'file-attachment',
          tid: '__docInput'
        }
      ]
      for (const f of files) {
        const fp = path.resolve(`tests/e2e/fixtures/test-files/${f.n}`)
        await alicePage.locator(`chat-view [data-testid$="${f.tid}"]`).setInputFiles(fp)
        const cap = `S ${f.n}`
        await alicePage.fill('chat-view textarea', cap)
        await alicePage.click('chat-view [data-testid$="__sendButton"]')
        await expect(alicePage.locator('chat-view .message-status-container span')).toHaveText('Sent', { timeout: 60000 })
        const row = bobPage.locator('timeline-row').filter({ hasText: f.n }).last()
        await expect(row).toBeVisible({ timeout: 60000 })
        await expect(row.locator(f.s).first()).toBeVisible({ timeout: 30000 })
      }
      await aliceContext.close()
      await bobContext.close()
    })

    test('video compression', async ({ page, loginCustomPage }) => {
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      await page.click('button[title="Create Room"]')
      await page.fill('input[placeholder="Search by username..."]', 'bob')
      await page.click('.search-result-item:has-text("bob")')
      await page.click('button:has-text("Create Room")')
      const vp = path.join(__dirname, 'fixtures', 'test-files', 'test.mp4')
      await page.setInputFiles('[data-testid$="__videoInput"]', vp)
      await expect(page.locator('chat-attachment-preview .x-small.text-muted')).toContainText('Ready to send', { timeout: 45000 })
      await page.click('.bi-send-fill')
      await expect(page.locator('timeline-row video').first()).toBeVisible({ timeout: 15000 })
    })
  })

  test.describe('Viewers and Lists', () => {
    test.beforeEach(async ({ page, loginApp }) => {
      await loginApp('alice', 'Password123!', 'VaultPassword123!')
      await page.click('button[title="Create Room"]')
      await page.fill('input[placeholder="Search by username..."]', 'bob')
      await page.click('.search-result-item:has-text("bob")')
      await page.click('button:has-text("Create Room")')
    })

    test('carousel and grid sync', async ({ page }) => {
      const ip = path.resolve('tests/e2e/fixtures/test-files/test.png')
      for (let i = 0; i < 2; i++) {
        await page.setInputFiles('[data-testid$="__imageInput"]', ip)
        await page.click('[data-testid$="__sendButton"]')
        await expect(page.locator('.message-status-container span').last()).toHaveText('Sent', { timeout: 20000 })
      }
      await page.click('button[title="Pictures"]')
      const cards = page.locator('media-grid-card')
      await cards.first().click()
      await page.click('.carousel-control-next')
      await expect(cards.nth(1).locator('.card')).toHaveClass(/is-active-card/)
    })

    test('jump to chat', async ({ page }) => {
      const ip = path.resolve('tests/e2e/fixtures/test-files/test.png')
      await page.setInputFiles('[data-testid$="__imageInput"]', ip)
      await page.click('[data-testid$="__sendButton"]')
      const img = page.locator('media-preview img').first()
      await expect(img).toBeVisible({ timeout: 15000 })
      await img.click()
      await page.click('image-viewer jump-to-chat button')
      await expect(page.locator('chat-view')).toBeVisible()
    })

    test('aggregate documents and links', async ({ page }) => {
      const dp = path.resolve('tests/e2e/fixtures/test-files/test.txt')
      await page.setInputFiles('[data-testid$="__docInput"]', dp)
      await page.click('[data-testid$="__sendButton"]')
      await expect(page.locator('.message-status-container span').last()).toHaveText('Sent', { timeout: 30000 })
      await page.click('[title="Documents"]')
      await expect(page.locator('document-list .app-list-item').filter({ hasText: 'test.txt' })).toBeVisible()

      await page.route('**/api/link-extraction*', async r => {
        await r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            title: 'PB',
            url: 'https://g.com'
          })
        })
      })
      await page.click('button[title="Chats"]')
      await page.fill('textarea', 'https://g.com ')
      await page.click('[data-testid$="__sendButton"]')
      await page.click('button[title="Links"]')
      await expect(page.locator('link-list .app-list-item')).toContainText('PB')
    })
  })

  test.describe('Media Manager', () => {
    test('takeover and playback', async ({ page, loginCustomPage }) => {
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      await page.click('button[title="Create Room"]')
      await page.fill('input[placeholder="Search by username..."]', 'bob')
      await page.click('.search-result-item:has-text("bob")')
      await page.click('button:has-text("Create Room")')
      const ap = path.resolve('tests/e2e/fixtures/test-files/test.mp3')
      await page.setInputFiles('[data-testid$="__audioInput"]', ap)
      await page.click('[data-testid$="__sendButton"]')
      await page.click('button[title="Music"]')
      await page.locator('music-list .app-list-item').first().click()
      await page.waitForTimeout(1000)
      await page.locator('button:has(i.bi-play-fill)').last().click()
      await expect(page.locator("button[title='Now Playing']").locator('i.bi-pause-fill')).toBeVisible({ timeout: 10000 })
    })
  })
})
