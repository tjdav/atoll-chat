import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Badge Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
  })

  test('should render basic count and truncate correctly', async ({ page }) => {
    // Inject atoll-badge dynamically
    await page.evaluate(() => {
      const el = document.createElement('atoll-badge')
      el.id = 'test-badge-count'
      el.setAttribute('count', '5')
      document.body.appendChild(el)
    })

    const badge = page.locator('#test-badge-count')
    const innerBadge = badge.locator('.atoll-badge')
    await expect(badge).toBeVisible()
    await expect(innerBadge).toHaveText('5')
    await expect(badge).toHaveAttribute('role', 'status')
    await expect(badge).toHaveAttribute('aria-label', '5 unread messages')

    // Truncate logic
    await page.evaluate(() => {
      const el = document.getElementById('test-badge-count')
      el.setAttribute('count', '150')
    })
    await expect(innerBadge).toHaveText('99+')
    await expect(badge).toHaveAttribute('aria-label', '99+ unread messages')

    // Test custom max-count
    await page.evaluate(() => {
      const el = document.getElementById('test-badge-count')
      el.setAttribute('max-count', '999')
    })
    await expect(innerBadge).toHaveText('150')
    await expect(badge).toHaveAttribute('aria-label', '150 unread messages')
  })

  test('should support dot mode', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-badge')
      el.id = 'test-badge-dot'
      el.setAttribute('dot', 'true')
      document.body.appendChild(el)
    })

    const badge = page.locator('#test-badge-dot')
    const innerBadge = badge.locator('.atoll-badge')
    await expect(badge).toBeVisible()
    await expect(innerBadge).toHaveText('')
    await expect(badge).toHaveAttribute('role', 'status')
    await expect(badge).toHaveAttribute('aria-label', 'New notification')

    // Check size of dot
    const box = await innerBadge.boundingBox()
    expect(box).not.toBeNull()
    expect(box.width).toBe(8)
    expect(box.height).toBe(8)
  })

  test('should handle auto-hiding for zero or null counts', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-badge')
      el.id = 'test-badge-hide'
      el.setAttribute('count', '0')
      document.body.appendChild(el)
    })

    const badge = page.locator('#test-badge-hide')
    const innerBadge = badge.locator('.atoll-badge')
    // Should be hidden by default for 0
    await expect(badge).toBeHidden()
    await expect(badge).toHaveAttribute('hidden', '')
    await expect(badge).toHaveAttribute('aria-hidden', 'true')

    // Should show when show-zero is set
    await page.evaluate(() => {
      const el = document.getElementById('test-badge-hide')
      el.setAttribute('show-zero', 'true')
    })
    await expect(badge).toBeVisible()
    await expect(innerBadge).toHaveText('0')
    await expect(badge).not.toHaveAttribute('hidden')
    await expect(badge).not.toHaveAttribute('aria-hidden')

    // Should hide when count is removed
    await page.evaluate(() => {
      const el = document.getElementById('test-badge-hide')
      el.removeAttribute('count')
    })
    await expect(badge).toBeHidden()
    await expect(badge).toHaveAttribute('hidden', '')
  })

  test('should support text/tag label mode', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-badge')
      el.id = 'test-badge-label'
      el.setAttribute('label', 'BOT')
      el.setAttribute('variant', 'secondary')
      el.setAttribute('size', 'sm')
      document.body.appendChild(el)
    })

    const badge = page.locator('#test-badge-label')
    const innerBadge = badge.locator('.atoll-badge')
    await expect(badge).toBeVisible()
    await expect(innerBadge).toHaveText('BOT')
    await expect(badge).toHaveAttribute('role', 'status')
    await expect(badge).toHaveAttribute('aria-label', 'BOT')
  })

  test('should render visual variants for screenshot', async ({ page }) => {
    await page.evaluate(() => {
      // Clear body and add a nice flex container
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 20px; padding: 40px; background-color: #f8f9fa; font-family: sans-serif; color: #111;">
          <h2>Atoll Chat Badge Component Architecture</h2>
          
          <div id="section-dots" style="display: flex; gap: 20px; align-items: center;">
            <strong>Dot Badges:</strong>
          </div>

          <div id="section-counts" style="display: flex; gap: 20px; align-items: center;">
            <strong>Unread Count Badges:</strong>
          </div>

          <div id="section-tags" style="display: flex; gap: 20px; align-items: center;">
            <strong>System Tag Labels:</strong>
          </div>
        </div>
      `

      // Programmatically create and append Dot badges
      const dot1 = document.createElement('atoll-badge')
      dot1.setAttribute('dot', 'true')
      dot1.setAttribute('variant', 'danger')
      document.getElementById('section-dots').appendChild(dot1)

      const dot2 = document.createElement('atoll-badge')
      dot2.setAttribute('dot', 'true')
      dot2.setAttribute('variant', 'primary')
      document.getElementById('section-dots').appendChild(dot2)

      // Programmatically create and append Count badges
      const count1 = document.createElement('atoll-badge')
      count1.setAttribute('count', '5')
      count1.setAttribute('variant', 'danger')
      document.getElementById('section-counts').appendChild(count1)

      const count2 = document.createElement('atoll-badge')
      count2.setAttribute('count', '12')
      count2.setAttribute('size', 'sm')
      count2.setAttribute('variant', 'primary')
      document.getElementById('section-counts').appendChild(count2)

      const count3 = document.createElement('atoll-badge')
      count3.setAttribute('count', '1420')
      count3.setAttribute('max-count', '99')
      count3.setAttribute('variant', 'danger')
      document.getElementById('section-counts').appendChild(count3)

      const count4 = document.createElement('atoll-badge')
      count4.setAttribute('count', '1420')
      count4.setAttribute('max-count', '999')
      count4.setAttribute('variant', 'info')
      document.getElementById('section-counts').appendChild(count4)

      // Programmatically create and append Tag labels
      const tag1 = document.createElement('atoll-badge')
      tag1.setAttribute('label', 'BOT')
      tag1.setAttribute('variant', 'secondary')
      tag1.setAttribute('size', 'sm')
      document.getElementById('section-tags').appendChild(tag1)

      const tag2 = document.createElement('atoll-badge')
      tag2.setAttribute('label', 'NEW')
      tag2.setAttribute('variant', 'primary')
      tag2.setAttribute('size', 'sm')
      document.getElementById('section-tags').appendChild(tag2)

      const tag3 = document.createElement('atoll-badge')
      tag3.setAttribute('label', 'FEATURE')
      tag3.setAttribute('variant', 'info')
      tag3.setAttribute('size', 'md')
      document.getElementById('section-tags').appendChild(tag3)
    })

    // Wait for elements to render
    await page.waitForTimeout(2000)

    const state = await page.evaluate(() => {
      const el = document.querySelector('atoll-badge[count="5"]')
      return {
        outerHTML: el ? el.outerHTML : null,
        countAttr: el ? el.getAttribute('count') : null,
        isHidden: el ? el.hasAttribute('hidden') : null,
        displayText: el ? el.innerText : null
      }
    })
    console.log('COUNT BADGE EVALUATION STATE:', JSON.stringify(state, null, 2))

    // Take screenshot
    await page.screenshot({ path: '/home/jules/verification/screenshots/verification.png' })
  })
})
