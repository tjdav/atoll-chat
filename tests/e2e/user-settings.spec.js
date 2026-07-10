import { test, expect } from './fixtures/base-test.js'
import path from 'path'

test.describe('User Settings & Profile', () => {

  test.describe('Profile', () => {
    test.beforeEach(async ({ loginApp }) => {
      await loginApp('alice', 'Password123!', 'VaultPassword123!')
    })

    test('update display name', async ({ browser, page, loginCustomPage }) => {
      await page.locator('[data-testid="nav-sidebar-0__btnSettings"]').click()
      const nn = 'Alice Wonderland'
      await page.locator('[data-testid="profile-settings-0__nameInput"]').fill(nn)
      await page.locator('[data-testid="profile-settings-0__btnSave"]').click()
      await expect(page.locator('.toast-body')).toContainText('Profile updated successfully!')
      const bc = await browser.newContext()
      const bp = await bc.newPage()
      await loginCustomPage(bp, 'bob', 'Password123!', 'VaultPassword123!')
      await bp.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
      await bp.locator('[data-testid="create-room-modal-0__searchInput"]').fill('alice')
      await expect(bp.locator('[data-testid$="search-result-alice"]')).toBeVisible({ timeout: 15000 })
      await bc.close()
    })

    test('update avatar', async ({ page }) => {
      await page.locator('[data-testid="nav-sidebar-0__btnSettings"]').click()
      const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-testid="profile-settings-0__avatarContainer"]').click()])
      await fc.setFiles({
        name: 'a.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
      })
      await page.locator('[data-testid="avatar-editor-0__btnApply"]').click()
      await page.locator('[data-testid="profile-settings-0__btnSave"]').click()
      await expect(page.locator('.avatar-circle img')).toBeVisible()
    })
  })

  test.describe('Sharing', () => {
    test('share media', async ({ page, loginCustomPage }) => {
      await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
      for (const n of ['bob', 'charlie']) {
        await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
        await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill(n)
        await page.locator(`[data-testid$="search-result-${n}"]`).click()
        await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
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
