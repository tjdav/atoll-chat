import { test, expect } from './fixtures/base-test.js'
import path from 'path'

test.describe('Documents Filter', () => {
  test('should show sent document in the documents list and viewer (Desktop)', async ({ page, loginApp }) => {
    // Login as alice
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Create room with bob
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')
    await expect(page.locator('chat-view header h6')).toContainText('bob')

    // Use existing test file
    const docPath = path.resolve('tests/e2e/fixtures/test-files/test.txt')
    const fileName = 'test.txt'

    // Send document
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.click('button[title="Attach Document"]')
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(docPath)
    await page.click('[data-testid$="__sendButton"]')

    // Wait for message to be sent
    // Wait for the "Sent" status to appear
    const statusContainer = page.locator('.message-status-container').last()
    await expect(statusContainer).toBeVisible({ timeout: 20000 })
    await expect(statusContainer.locator('span')).toHaveText('Sent', { timeout: 60000 })

    // Go to Documents filter
    await page.click('[title="Documents"]')

    // Verify document is in the list
    const docItem = page.locator('document-list .app-list-item').filter({ hasText: fileName }).first()
    await expect(docItem).toBeVisible()

    // Click on document and verify viewer
    await docItem.click()

    await expect(page.locator('.detail-view document-viewer')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.detail-view document-viewer h4')).toHaveText(fileName, { timeout: 15000 })
    await expect(page.locator('.detail-view document-viewer a.btn-primary')).toBeVisible({ timeout: 15000 })
  })

  test('should show sent document in the documents list and viewer (Mobile)', async ({ page, loginApp }) => {
    // Set viewport to mobile size
    await page.setViewportSize({
      width: 375,
      height: 667
    })

    // Login as alice
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Create room with bob
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')

    // In mobile, creating a room should automatically open it and hide the sidebar
    await expect(page.locator('chat-view header h6')).toContainText('bob')

    // Use existing test file
    const docPath = path.resolve('tests/e2e/fixtures/test-files/test.txt')
    const fileName = 'test.txt'

    // Send document
    // Click paperclip button
    await page.click('button[title="Attach"]')

    const fileChooserPromise = page.waitForEvent('filechooser')
    // Click "Document" in the dropup
    await page.click('.dropdown-menu.show >> text=Document')
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(docPath)
    await page.click('[data-testid$="__sendButton"]')

    // Wait for message to be sent
    console.log('Waiting for message to be sent...')
    const statusContainer = page.locator('.message-status-container').last()
    await expect(statusContainer).toBeVisible({ timeout: 20000 })
    await expect(statusContainer.locator('span')).toHaveText('Sent', { timeout: 60000 })

    // Go to Documents filter
    // On mobile, we need to open the mobile nav to see the filters
    await page.click('chat-view header button i.bi-chevron-left')
    await page.click('.mobile-nav-offcanvas [title="Documents"]')

    // Verify document is in the list
    const docItem = page.locator('document-list .app-list-item').filter({ hasText: fileName }).first()
    await expect(docItem).toBeVisible()

    // Click on document and verify viewer
    await docItem.click()

    // In mobile, clicking an item should show the detail view
    await expect(page.locator('.detail-view document-viewer')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.detail-view document-viewer h4')).toHaveText(fileName, { timeout: 15000 })
  })
})
