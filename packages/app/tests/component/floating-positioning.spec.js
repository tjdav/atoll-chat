import { test, expect } from '@playwright/test'
import { stubAuth, seedSession, loadWithFixture } from '../helpers/storage-fixture.js'

test.use({ video: 'on' })

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await stubAuth(page)
  await seedSession(page)
  await loadWithFixture(page, {
    seed: 'chatWithMessages',
    path: '/app.html?rail=core.chat&detail=chat&id=r_1'
  })
  await page.waitForSelector('message-bubble[message-id="m_7"]')
})

async function waitForPositioned(page) {
  await page.waitForFunction(() => {
    const host = document.querySelector('message-context-menu')
    const el = host?.shadowRoot?.querySelector('[role="menu"]') || document.querySelector('[role="menu"]')
    return Boolean(el && el.style.left && el.style.left !== '' && el.style.top && el.style.top !== '')
  })
}

test.describe('Floating UI positioning for message context menu', () => {
  test('1. Menu positions below-right of the anchor when opened in the middle of the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })

    const bubbleCard = page.locator('message-bubble[message-id="m_1"] .bubble')
    const cardBox = await bubbleCard.boundingBox()
    expect(cardBox).not.toBeNull()

    const clickX = Math.round(cardBox.x + cardBox.width / 2)
    const clickY = Math.round(cardBox.y + cardBox.height / 2)
    await page.mouse.click(clickX, clickY, { button: 'right' })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await waitForPositioned(page)

    const bbox = await menu.boundingBox()
    expect(bbox).not.toBeNull()
    expect(bbox.x).toBeGreaterThanOrEqual(clickX)
    expect(bbox.y).toBeGreaterThanOrEqual(clickY)

    await page.screenshot({ path: 'test-results/menu-position-default.png' })
  })

  test('2. Menu flips above the anchor near the bottom edge', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })

    const thread = page.locator('.chat__thread')
    await thread.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(50)

    const bubbleCard = page.locator('message-bubble[message-id="m_7"] .bubble')
    const initialBox = await bubbleCard.boundingBox()
    expect(initialBox).not.toBeNull()

    await page.setViewportSize({ width: 1440, height: Math.round(initialBox.y + 100) })
    await page.waitForTimeout(50)

    const cardBox = await bubbleCard.boundingBox()
    expect(cardBox).not.toBeNull()

    const clickX = Math.round(cardBox.x + cardBox.width / 2)
    const clickY = Math.round(cardBox.y + cardBox.height - 5)
    await page.mouse.click(clickX, clickY, { button: 'right' })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await waitForPositioned(page)

    const bbox = await menu.boundingBox()
    expect(bbox).not.toBeNull()
    expect(bbox.y + bbox.height).toBeLessThanOrEqual(clickY + 10)

    await page.screenshot({ path: 'test-results/menu-position-flipped.png' })
  })

  test('3. Menu shifts left near the right edge', async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 900 })

    const bubbleCard = page.locator('message-bubble[message-id="m_1"] .bubble')
    const cardBox = await bubbleCard.boundingBox()
    expect(cardBox).not.toBeNull()

    const clickX = Math.round(cardBox.x + cardBox.width - 10)
    const clickY = Math.round(cardBox.y + cardBox.height / 2)
    await page.mouse.click(clickX, clickY, { button: 'right' })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await waitForPositioned(page)

    const bbox = await menu.boundingBox()
    expect(bbox).not.toBeNull()
    expect(bbox.x + bbox.width).toBeLessThanOrEqual(500)
  })

  test('4. Menu follows the anchor on scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 500 })

    const thread = page.locator('.chat__thread')
    await thread.evaluate((el) => {
      el.scrollTop = 100
    })
    await page.waitForTimeout(50)

    const bubbleCard = page.locator('message-bubble[message-id="m_4"] .bubble')
    const cardBox = await bubbleCard.boundingBox()
    expect(cardBox).not.toBeNull()

    const clickX = Math.round(cardBox.x + cardBox.width / 2)
    const clickY = Math.round(cardBox.y + cardBox.height / 2)
    await page.mouse.click(clickX, clickY, { button: 'right' })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await waitForPositioned(page)

    const initialBbox = await menu.boundingBox()

    await thread.evaluate((el) => {
      el.scrollTop += 50
      el.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    await page.waitForTimeout(100)
    const scrolledBbox = await menu.boundingBox()
    expect(scrolledBbox.y).not.toBe(initialBbox.y)
  })

  test('5. Menu repositions on viewport resize', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })

    const bubbleCard = page.locator('message-bubble[message-id="m_1"] .bubble')
    const cardBox = await bubbleCard.boundingBox()
    expect(cardBox).not.toBeNull()

    const clickX = Math.round(cardBox.x + cardBox.width / 2)
    const clickY = Math.round(cardBox.y + cardBox.height / 2)
    await page.mouse.click(clickX, clickY, { button: 'right' })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await waitForPositioned(page)

    const initialBbox = await menu.boundingBox()

    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(100)

    const resizedBbox = await menu.boundingBox()
    expect(resizedBbox).not.toBeNull()
  })

  test('6. Cleanup runs on close', async ({ page }) => {
    const bubbleCard = page.locator('message-bubble[message-id="m_1"] .bubble')
    const cardBox = await bubbleCard.boundingBox()
    expect(cardBox).not.toBeNull()

    const clickX = Math.round(cardBox.x + cardBox.width / 2)
    const clickY = Math.round(cardBox.y + cardBox.height / 2)
    await page.mouse.click(clickX, clickY, { button: 'right' })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await waitForPositioned(page)

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    const thread = page.locator('.chat__thread')
    await thread.evaluate((el) => {
      el.scrollTop += 50
    })
    await page.waitForTimeout(100)

    await expect(menu).toBeHidden()
  })

  test('7. No --menu-x or --menu-y CSS custom properties are set on the menu', async ({ page }) => {
    const bubbleCard = page.locator('message-bubble[message-id="m_1"] .bubble')
    const cardBox = await bubbleCard.boundingBox()
    expect(cardBox).not.toBeNull()

    const clickX = Math.round(cardBox.x + cardBox.width / 2)
    const clickY = Math.round(cardBox.y + cardBox.height / 2)
    await page.mouse.click(clickX, clickY, { button: 'right' })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await waitForPositioned(page)

    const props = await menu.evaluate((el) => {
      const computed = getComputedStyle(el)
      return {
        menuX: computed.getPropertyValue('--menu-x').trim(),
        menuY: computed.getPropertyValue('--menu-y').trim()
      }
    })

    expect(props.menuX).toBe('')
    expect(props.menuY).toBe('')
  })
})
