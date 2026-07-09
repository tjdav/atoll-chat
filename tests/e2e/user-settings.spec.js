import { test, expect } from './fixtures/base-test.js'
import path from 'path'

test.describe('User Settings & Profile', () => {

  test.describe('Profile', () => {
    test.beforeEach(async ({ loginApp }) => {
      await loginApp('alice', 'Password123!', 'VaultPassword123!')
    })

    test('update display name', async ({ browser, page, loginCustomPage }) => {
      await page.click('button[title="Settings"]')
      const nn = 'Alice Wonderland'
      await page.fill('input[placeholder="Enter your display name"]', nn)
      await page.click('button:has-text("Save Changes")')
      await expect(page.locator('.toast-body')).toContainText('Profile updated successfully!')
      const bc = await browser.newContext()
      const bp = await bc.newPage()
      await loginCustomPage(bp, 'bob', 'Password123!', 'VaultPassword123!')
      await bp.click('button[title="Create Room"]')
      await bp.fill('input[placeholder="Search by username or email..."]', 'alice')
      await expect(bp.locator('.search-result-item:has-text("' + nn + '")')).toBeVisible({ timeout: 15000 })
      await bc.close()
    })

    test('update avatar', async ({ page }) => {
      await page.click('button[title="Settings"]')
      const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.position-relative.cursor-pointer').click()])
      await fc.setFiles({
        name: 'a.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
      })
      await page.click('button:has-text("Apply Changes")')
      await page.click('button:has-text("Save Changes")')
      await expect(page.locator('.avatar-circle img')).toBeVisible()
    })
  })

  test.describe('Sharing', () => {
    test('share media', async ({ page, loginCustomPage }) => {
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      for (const n of ['bob', 'charlie']) {
        await page.click('button[title="Create Room"]')
        await page.fill('input[placeholder="Search by username or email..."]', n)
        await page.click(`.search-result-item:has-text("${n}")`)
        await page.click('button:has-text("Create Room")')
      }
      const ip = path.resolve('tests/e2e/fixtures/test-files/test.png')
      await page.setInputFiles('[data-testid$="__imageInput"]', ip)
      await page.click('[data-testid$="__sendButton"]')
      await page.locator('media-preview img').first().click()
      await page.locator('share-button button').filter({ visible: true }).click()
      const sm = page.locator('.modal.show').filter({ hasText: 'Share to...' })
      await sm.locator('label').filter({ hasText: 'bob' }).first().click()
      await sm.locator('button:has-text("Send")').click()
      await expect(page.locator('.toast.show')).toContainText('Shared with 1 room')
    })
  })
})
