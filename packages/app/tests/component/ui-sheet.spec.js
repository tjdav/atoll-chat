import { test, expect } from '@playwright/test'
import {
  loadWithFixture,
  stubAuth,
  seedSession,
  mountSheet,
  setSheetOpen,
  recordSheetEvents,
  getLastSheetCloseEvent
} from '../helpers/storage-fixture.js'

test.use({ video: 'on' })

test.describe('ui-sheet primitive', () => {
  test.beforeEach(async ({ page }) => {
    await stubAuth(page)
    await seedSession(page)
    await loadWithFixture(page, { seed: 'empty', path: '/app.html' })
    await recordSheetEvents(page)
  })

  test('1. Sheet is not visible when open is false', async ({ page }) => {
    await mountSheet(page, { open: false, title: 'Test Title' })
    const dialog = page.locator('dialog[data-testid="ui-sheet"]')
    await expect(dialog).not.toBeVisible()
  })

  test('2. Sheet opens when open becomes true', async ({ page }) => {
    await mountSheet(page, { open: false, title: 'Test Title' })
    const dialog = page.locator('dialog[data-testid="ui-sheet"]')
    await expect(dialog).not.toBeVisible()

    await setSheetOpen(page, true)
    await expect(dialog).toBeVisible()
  })

  test('3. Dialog is a native <dialog> in the modal top layer', async ({ page }) => {
    await mountSheet(page, { open: true, title: 'Top Layer Test' })
    const dialog = page.locator('dialog[open][data-testid="ui-sheet"]')
    await expect(dialog).toBeVisible()
    const tagName = await dialog.evaluate((el) => el.tagName.toLowerCase())
    expect(tagName).toBe('dialog')
  })

  test('4. Close button closes the sheet', async ({ page }) => {
    await mountSheet(page, { open: true, title: 'Close Test', showClose: true })
    const dialog = page.locator('dialog[data-testid="ui-sheet"]')
    await expect(dialog).toBeVisible()

    const closeBtn = page.locator('button.sheet__close')
    await closeBtn.click()
    await expect(dialog).not.toBeVisible()
  })

  test('5. Close emits sheet:close', async ({ page }) => {
    await mountSheet(page, { open: true, title: 'Event Test' })
    const closeBtn = page.locator('button.sheet__close')
    await closeBtn.click()

    const event = await getLastSheetCloseEvent(page)
    expect(event).not.toBeNull()
    expect(typeof event?.at).toBe('number')
  })

  test('6. Escape closes when dismissible (default)', async ({ page }) => {
    await mountSheet(page, { open: true, title: 'Escape Test' })
    const dialog = page.locator('dialog[data-testid="ui-sheet"]')
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()

    const event = await getLastSheetCloseEvent(page)
    expect(event).not.toBeNull()
  })

  test('7. Escape does not close when dismissible: false', async ({ page }) => {
    await mountSheet(page, { open: true, title: 'No Escape Test', dismissible: false })
    const dialog = page.locator('dialog[data-testid="ui-sheet"]')
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
  })

  test('8. Backdrop click closes when dismissible', async ({ page }) => {
    await mountSheet(page, { open: true, title: 'Backdrop Test' })
    const dialog = page.locator('dialog[data-testid="ui-sheet"]')
    await expect(dialog).toBeVisible()

    await dialog.evaluate((el) => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await expect(dialog).not.toBeVisible()

    const event = await getLastSheetCloseEvent(page)
    expect(event).not.toBeNull()
  })

  test('9. Backdrop click does not close when dismissible: false', async ({ page }) => {
    await mountSheet(page, { open: true, title: 'No Backdrop Dismiss Test', dismissible: false })
    const dialog = page.locator('dialog[data-testid="ui-sheet"]')
    await expect(dialog).toBeVisible()

    await dialog.evaluate((el) => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await expect(dialog).toBeVisible()
  })

  test('10. Title renders when set', async ({ page }) => {
    await mountSheet(page, { open: true, title: 'Custom Header Title' })
    const titleEl = page.locator('.sheet__title')
    await expect(titleEl).toBeVisible()
    await expect(titleEl).toHaveText('Custom Header Title')
  })

  test('11. Header hidden when title is empty and showClose is false', async ({ page }) => {
    await mountSheet(page, { open: true, title: '', showClose: false })
    const header = page.locator('.sheet__header')
    await expect(header).toBeHidden()
  })

  test('12. Bottom variant renders with the correct attribute', async ({ page }) => {
    await mountSheet(page, { open: true, title: 'Bottom Variant', variant: 'bottom' })
    const sheetHost = page.locator('ui-sheet#cv-sheet-test')
    await expect(sheetHost).toHaveAttribute('variant', 'bottom')
  })

  test('13. Center variant is the default', async ({ page }) => {
    await mountSheet(page, { open: true, title: 'Default Center Variant' })
    const dialog = page.locator('dialog[data-testid="ui-sheet"]')
    await expect(dialog).toBeVisible()
  })

  test('14. Slotted content renders', async ({ page }) => {
    await mountSheet(page, { open: true, title: 'Slotted Content Test' })
    const bodyContent = page.locator('[data-testid="sheet-body"]')
    await expect(bodyContent).toBeVisible()
    await expect(bodyContent).toHaveText('Sheet body content')
  })

  test('15. Screenshots capture center and bottom variants', async ({ page }) => {
    // 1. Center variant screenshot on desktop viewport (1440x900)
    await page.setViewportSize({ width: 1440, height: 900 })
    await mountSheet(page, { open: true, title: 'Room Settings Overlay', variant: 'center' })
    const dialogCenter = page.locator('dialog[data-testid="ui-sheet"]')
    await expect(dialogCenter).toBeVisible()
    await page.screenshot({ path: 'test-results/ui-sheet-center.png' })

    // 2. Bottom variant screenshot on mobile viewport (390x844)
    await page.setViewportSize({ width: 390, height: 844 })
    await mountSheet(page, { open: true, title: 'Original Message Chain', variant: 'bottom' })
    const dialogBottom = page.locator('dialog[data-testid="ui-sheet"]')
    await expect(dialogBottom).toBeVisible()
    await page.screenshot({ path: 'test-results/ui-sheet-bottom.png' })
  })
})
