import { test, expect } from './fixtures/base-test.js'
import path from 'path'
import fs from 'fs'

test.describe('Documents Filter', () => {
  test('should show sent document in the documents list and viewer', async ({ page, loginApp }) => {
    // 1. Login as alice
    await loginApp('alice', 'Password123!', '123456')

    // 2. Create room with bob
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')
    await expect(page.locator('chat-view header h6')).toContainText('bob')

    // 3. Create a dummy document
    const docPath = path.join(process.cwd(), 'e2e-test-doc.txt')
    fs.writeFileSync(docPath, 'E2E Test Document Content')

    // 4. Send document
    console.log('Sending document...')
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.click('button[title="Attach file"]')
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(docPath)
    await page.click('button:has-text("Send")')

    // 5. Wait for message to be sent
    console.log('Waiting for message to be sent...')
    await expect(page.locator('.placeholder-glow')).toHaveCount(0, { timeout: 30000 })

    // 6. Go to Documents filter
    console.log('Going to Documents filter...')
    await page.click('[title="Documents"]')

    // 7. Verify document is in the list
    console.log('Verifying document in list...')
    const docItem = page.locator('document-list .list-group-item').filter({ hasText: 'e2e-test-doc.txt' }).first()
    await expect(docItem).toBeVisible()

    // 8. Click on document and verify viewer
    console.log('Verifying document viewer...')
    await docItem.click()

    await expect(page.locator('.detail-view document-viewer')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.detail-view document-viewer h4')).toHaveText('e2e-test-doc.txt', { timeout: 15000 })
    await expect(page.locator('.detail-view document-viewer a.btn-primary')).toBeVisible({ timeout: 15000 })

    // Cleanup
    fs.unlinkSync(docPath)
  })
})
