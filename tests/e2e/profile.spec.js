import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Profile Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
  })

  test('should render 8 strict sizes correctly', async ({ page }) => {
    const sizes = {
      '2xs': 30,
      xs: 32,
      sm: 42,
      md: 50,
      lg: 56,
      xl: 60,
      '2xl': 87,
      '3xl': 95
    }

    for (const [sizeName, expectedPx] of Object.entries(sizes)) {
      await page.evaluate((size) => {
        const el = document.createElement('atoll-profile')
        el.id = `profile-size-${size}`
        el.setAttribute('size', size)
        document.body.appendChild(el)
      }, sizeName)

      const profile = page.locator(`#profile-size-${sizeName} .atoll-profile`)
      await expect(profile).toBeVisible()

      const box = await profile.boundingBox()
      expect(box).not.toBeNull()
      expect(Math.round(box.width)).toBe(expectedPx)
      expect(Math.round(box.height)).toBe(expectedPx)
    }
  })

  test('should support dynamic src loading and avoid 404 console errors', async ({ page }) => {
    const failedRequests = []
    page.on('requestfailed', (request) => {
      failedRequests.push(request.url())
    })

    await page.evaluate(() => {
      const el = document.createElement('atoll-profile')
      el.id = 'profile-lazy-test'
      document.body.appendChild(el)
    })

    const profile = page.locator('#profile-lazy-test')
    await expect(profile).toBeVisible()

    const hasUnhydrated404 = failedRequests.some((url) => {
      return url.includes('%7B') || url.includes('%7D')
    })
    expect(hasUnhydrated404).toBe(false)

    const fallback = profile.locator('.atoll-profile-fallback')
    await expect(fallback).toBeVisible()

    await page.evaluate(() => {
      const el = document.getElementById('profile-lazy-test')
      el.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')
    })

    await expect(fallback).toBeHidden()
  })

  test('should handle multiparty split quadrants and fallback rendering', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-profile')
      el.id = 'profile-multiparty-test'
      el.setAttribute('type', 'multiparty')
      el.setAttribute('split-count', '4')

      const imgContainer = document.createElement('div')
      imgContainer.setAttribute('slot', 'image')

      const img1 = document.createElement('img')
      img1.id = 'mp-img-1'
      img1.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      imgContainer.appendChild(img1)

      const img2 = document.createElement('img')
      img2.id = 'mp-img-2'
      img2.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      imgContainer.appendChild(img2)

      el.appendChild(imgContainer)
      document.body.appendChild(el)
    })

    const profile = page.locator('#profile-multiparty-test')
    await expect(profile).toBeVisible()

    const circle = profile.locator('.atoll-profile-circle')
    await expect(circle).toHaveClass(/multiparty-4/)

    const fallbacks = profile.locator('[slot="image"] .atoll-profile-fallback')
    await expect(fallbacks).toHaveCount(2)

    await page.evaluate(() => {
      const img1 = document.getElementById('mp-img-1')
      img1.dispatchEvent(new Event('error'))
    })

    await expect(fallbacks).toHaveCount(3)
  })

  test('should render dynamic initials and deterministic hashed color background', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-profile')
      el.id = 'profile-initials-test'
      el.setAttribute('alt', 'John Doe')
      document.body.appendChild(el)
    })

    const profile = page.locator('#profile-initials-test')
    await expect(profile).toBeVisible()

    const initials = profile.locator('.atoll-profile-initials')
    await expect(initials).toBeVisible()
    await expect(initials).toHaveText('JD')

    const fallback = profile.locator('.atoll-profile-fallback')
    const styleAttr = await fallback.getAttribute('style')
    expect(styleAttr).toContain('background-color:')
  })

  test('should support active story ring and top/bottom overlays', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-profile')
      el.id = 'profile-overlays-test'
      el.setAttribute('ring', 'true')
      el.setAttribute('badge', '5')
      el.setAttribute('icon-name', 'camera')
      document.body.appendChild(el)
    })

    const profile = page.locator('#profile-overlays-test')
    await expect(profile).toBeVisible()

    const innerDiv = profile.locator('.atoll-profile')
    await expect(innerDiv).toHaveClass(/atoll-profile-ring/)

    const badge = profile.locator('.atoll-profile-badge')
    await expect(badge).toBeVisible()
    await expect(badge.locator('atoll-badge')).toHaveAttribute('count', '5')

    const icon = profile.locator('.atoll-profile-icon')
    await expect(icon).toBeVisible()
    await expect(icon.locator('atoll-icon')).toHaveAttribute('name', 'camera')
  })

  test('should render visual matrix for screenshot', async ({ page }) => {
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 20px; padding: 40px; background-color: #f8f9fa; font-family: sans-serif; color: #111;">
          <h2>Atoll Chat Profile Component Architecture</h2>
          
          <div id="section-sizes" style="display: flex; gap: 20px; align-items: center;">
            <strong>Sizes:</strong>
          </div>

          <div id="section-overlays" style="display: flex; gap: 20px; align-items: center;">
            <strong>Ring, Badge, and Icon Overlays:</strong>
          </div>

          <div id="section-multiparty" style="display: flex; gap: 20px; align-items: center;">
            <strong>Multiparty Grids (2, 3, 4 Slices):</strong>
          </div>

          <div id="section-grouped" style="display: flex; gap: 20px; align-items: center;">
            <strong>Grouped Overlapping Rows:</strong>
          </div>
        </div>
      `

      const sizesList = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']
      const sizesSection = document.getElementById('section-sizes')
      sizesList.forEach((size) => {
        const prof = document.createElement('atoll-profile')
        prof.setAttribute('size', size)
        sizesSection.appendChild(prof)
      })

      const overlaysSection = document.getElementById('section-overlays')

      const profRing = document.createElement('atoll-profile')
      profRing.setAttribute('size', 'lg')
      profRing.setAttribute('ring', 'true')
      overlaysSection.appendChild(profRing)

      const profBadge = document.createElement('atoll-profile')
      profBadge.setAttribute('size', 'lg')
      profBadge.setAttribute('badge', '12')
      overlaysSection.appendChild(profBadge)

      const profIcon = document.createElement('atoll-profile')
      profIcon.setAttribute('size', 'lg')
      profIcon.setAttribute('icon-name', 'camera')
      overlaysSection.appendChild(profIcon)

      const profAll = document.createElement('atoll-profile')
      profAll.setAttribute('size', 'lg')
      profAll.setAttribute('ring', 'true')
      profAll.setAttribute('badge', '99')
      profAll.setAttribute('icon-name', 'settings')
      overlaysSection.appendChild(profAll)

      const multipartySection = document.getElementById('section-multiparty')

      const mp2 = document.createElement('atoll-profile')
      mp2.setAttribute('type', 'multiparty')
      mp2.setAttribute('split-count', '2')
      mp2.setAttribute('size', 'xl')
      const slot2 = document.createElement('div')
      slot2.setAttribute('slot', 'image')
      mp2.appendChild(slot2)
      multipartySection.appendChild(mp2)

      const mp3 = document.createElement('atoll-profile')
      mp3.setAttribute('type', 'multiparty')
      mp3.setAttribute('split-count', '3')
      mp3.setAttribute('size', 'xl')
      const slot3 = document.createElement('div')
      slot3.setAttribute('slot', 'image')
      mp3.appendChild(slot3)
      multipartySection.appendChild(mp3)

      const mp4 = document.createElement('atoll-profile')
      mp4.setAttribute('type', 'multiparty')
      mp4.setAttribute('split-count', '4')
      mp4.setAttribute('size', 'xl')
      const slot4 = document.createElement('div')
      slot4.setAttribute('slot', 'image')
      mp4.appendChild(slot4)
      multipartySection.appendChild(mp4)

      const groupedSection = document.getElementById('section-grouped')
      const row = document.createElement('div')
      row.className = 'atoll-profile-group-row'

      const p1 = document.createElement('atoll-profile')
      p1.setAttribute('size', 'sm')
      row.appendChild(p1)

      const p2 = document.createElement('atoll-profile')
      p2.setAttribute('size', 'sm')
      row.appendChild(p2)

      const p3 = document.createElement('atoll-profile')
      p3.setAttribute('size', 'sm')
      row.appendChild(p3)

      groupedSection.appendChild(row)
    })

    await page.waitForTimeout(2000)
    await page.screenshot({
      path: 'tests/e2e/screenshots/profile-verification.png'
    })
  })
})
