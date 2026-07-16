import { test, expect } from './fixtures/base-test.js'
import path from 'path'

test.describe('User Settings & Profile', () => {

  test.describe('Profile', () => {
    test.beforeEach(async ({ loginApp }) => {
      await loginApp('alice', 'Password123!', 'VaultPassword123!')
    })

    test('update display name', async ({ browser, page, loginCustomPage }) => {
      await page.locator('[data-testid="nav-sidebar-0__profileBtn"]').click()
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
      await page.locator('[data-testid="nav-sidebar-0__profileBtn"]').click()
      await page.locator('[data-testid="nav-sidebar-0__btnSettings"]').click()
      const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-testid="profile-settings-0__avatarContainer"]').click()])
      await fc.setFiles({
        name: 'a.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
      })
      await page.locator('[data-testid="avatar-editor-0__btnApply"]').click()
      await expect(page.locator('[data-testid="profile-settings-0__btnSave"]')).toBeEnabled()
      await page.locator('[data-testid="profile-settings-0__btnSave"]').click()
      await expect(page.locator('.avatar-circle img')).toBeVisible()
    })

    test('mobile touch editing of avatar (drag and pinch)', async ({ page }) => {
      await page.locator('[data-testid="nav-sidebar-0__profileBtn"]').click()
      await page.locator('[data-testid="nav-sidebar-0__btnSettings"]').click()
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('[data-testid="profile-settings-0__avatarContainer"]').click()
      ])
      await fc.setFiles({
        name: 'a.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
      })

      // Wait for editor canvas to be visible
      const canvasLocator = page.locator('avatar-editor canvas')
      await expect(canvasLocator).toBeVisible()

      // Simulate pinch-to-zoom and drag-to-move using Touch API in browser context
      const scales = await page.evaluate(async () => {
        const canvas = document.querySelector('avatar-editor canvas')
        const zoomRange = document.querySelector('avatar-editor input[type="range"]')
        if (!canvas || !zoomRange) {
          throw new Error('Canvas or zoom slider not found')
        }

        const rect = canvas.getBoundingClientRect()
        const startX = rect.left + (rect.width / 2)
        const startY = rect.top + (rect.height / 2)
        const initialVal = parseFloat(zoomRange.value)

        // simulate touch drag
        const touchDragStart = new Touch({
          identifier: 1,
          target: canvas,
          clientX: startX,
          clientY: startY,
          pageX: startX,
          pageY: startY
        })
        canvas.dispatchEvent(new TouchEvent('touchstart', {
          touches: [touchDragStart],
          targetTouches: [touchDragStart],
          changedTouches: [touchDragStart],
          bubbles: true,
          cancelable: true
        }))

        const touchDragMove = new Touch({
          identifier: 1,
          target: canvas,
          clientX: startX + 50,
          clientY: startY + 50,
          pageX: startX + 50,
          pageY: startY + 50
        })
        window.dispatchEvent(new TouchEvent('touchmove', {
          touches: [touchDragMove],
          targetTouches: [touchDragMove],
          changedTouches: [touchDragMove],
          bubbles: true,
          cancelable: true
        }))

        window.dispatchEvent(new TouchEvent('touchend', {
          touches: [],
          targetTouches: [],
          changedTouches: [touchDragMove],
          bubbles: true,
          cancelable: true
        }))

        // simulate pinch-to-zoom
        const touch1Start = new Touch({
          identifier: 2,
          target: canvas,
          clientX: startX - 20,
          clientY: startY,
          pageX: startX - 20,
          pageY: startY
        })
        const touch2Start = new Touch({
          identifier: 3,
          target: canvas,
          clientX: startX + 20,
          clientY: startY,
          pageX: startX + 20,
          pageY: startY
        })
        canvas.dispatchEvent(new TouchEvent('touchstart', {
          touches: [touch1Start, touch2Start],
          targetTouches: [touch1Start, touch2Start],
          changedTouches: [touch1Start, touch2Start],
          bubbles: true,
          cancelable: true
        }))

        const touch1Move = new Touch({
          identifier: 2,
          target: canvas,
          clientX: startX - 60,
          clientY: startY,
          pageX: startX - 60,
          pageY: startY
        })
        const touch2Move = new Touch({
          identifier: 3,
          target: canvas,
          clientX: startX + 60,
          clientY: startY,
          pageX: startX + 60,
          pageY: startY
        })
        window.dispatchEvent(new TouchEvent('touchmove', {
          touches: [touch1Move, touch2Move],
          targetTouches: [touch1Move, touch2Move],
          changedTouches: [touch1Move, touch2Move],
          bubbles: true,
          cancelable: true
        }))

        window.dispatchEvent(new TouchEvent('touchend', {
          touches: [],
          targetTouches: [],
          changedTouches: [touch1Move, touch2Move],
          bubbles: true,
          cancelable: true
        }))

        return {
          initialVal,
          finalVal: parseFloat(zoomRange.value)
        }
      })

      // Assert that zoom value increased due to pinch-to-zoom
      expect(scales.finalVal).toBeGreaterThan(scales.initialVal)

      await page.locator('[data-testid="avatar-editor-0__btnApply"]').click()
      await expect(page.locator('[data-testid="profile-settings-0__btnSave"]')).toBeEnabled()
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
      await page.setInputFiles('[data-testid$="__fileInput"]', ip)
      await page.click('[data-testid$="__sendButton"]')
      await page.locator('timeline-item-media img').first().click()
      await page.locator('share-button button').filter({ visible: true }).click()
      const sm = page.locator('.modal.show').filter({ hasText: 'Share to...' })
      await sm.locator('label').filter({ hasText: 'bob' }).first().click()
      await sm.locator('button:has-text("Send")').click()
      await expect(page.locator('.toast.show')).toContainText('Shared with 1 room')
    })
  })
})
