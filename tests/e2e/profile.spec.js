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

      const profile = page.locator(`#profile-size-${sizeName}`).locator('.atoll-profile')
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

    const innerDiv = profile.locator('div.atoll-profile')
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

      const img2a = document.createElement('span')
      img2a.className = 'atoll-profile-fallback'
      img2a.style.backgroundColor = '#6B3CC9'
      img2a.style.color = '#FFFFFF'
      const icon2a = document.createElement('atoll-icon')
      icon2a.setAttribute('name', 'user')
      icon2a.setAttribute('size', '14')
      img2a.appendChild(icon2a)

      const img2b = document.createElement('span')
      img2b.className = 'atoll-profile-fallback'
      img2b.style.backgroundColor = '#0093C4'
      img2b.style.color = '#FFFFFF'
      const icon2b = document.createElement('atoll-icon')
      icon2b.setAttribute('name', 'user')
      icon2b.setAttribute('size', '14')
      img2b.appendChild(icon2b)

      slot2.appendChild(img2a)
      slot2.appendChild(img2b)
      mp2.appendChild(slot2)
      multipartySection.appendChild(mp2)

      const mp3 = document.createElement('atoll-profile')
      mp3.setAttribute('type', 'multiparty')
      mp3.setAttribute('split-count', '3')
      mp3.setAttribute('size', 'xl')
      const slot3 = document.createElement('div')
      slot3.setAttribute('slot', 'image')

      const img3a = document.createElement('span')
      img3a.className = 'atoll-profile-fallback'
      img3a.style.backgroundColor = '#0093C4'
      img3a.style.color = '#FFFFFF'
      const icon3a = document.createElement('atoll-icon')
      icon3a.setAttribute('name', 'user')
      icon3a.setAttribute('size', '14')
      img3a.appendChild(icon3a)

      const img3b = document.createElement('span')
      img3b.className = 'atoll-profile-fallback'
      img3b.style.backgroundColor = '#6B3CC9'
      img3b.style.color = '#FFFFFF'
      const icon3b = document.createElement('atoll-icon')
      icon3b.setAttribute('name', 'user')
      icon3b.setAttribute('size', '14')
      img3b.appendChild(icon3b)

      const img3c = document.createElement('span')
      img3c.className = 'atoll-profile-fallback'
      img3c.style.backgroundColor = '#15BD66'
      img3c.style.color = '#FFFFFF'
      const icon3c = document.createElement('atoll-icon')
      icon3c.setAttribute('name', 'user')
      icon3c.setAttribute('size', '14')
      img3c.appendChild(icon3c)

      slot3.appendChild(img3a)
      slot3.appendChild(img3b)
      slot3.appendChild(img3c)
      mp3.appendChild(slot3)
      multipartySection.appendChild(mp3)

      const mp4 = document.createElement('atoll-profile')
      mp4.setAttribute('type', 'multiparty')
      mp4.setAttribute('split-count', '4')
      mp4.setAttribute('size', 'xl')
      const slot4 = document.createElement('div')
      slot4.setAttribute('slot', 'image')

      const colors4 = ['#6B3CC9', '#0093C4', '#15BD66', '#FCB321']
      colors4.forEach((col) => {
        const span = document.createElement('span')
        span.className = 'atoll-profile-fallback'
        span.style.backgroundColor = col
        span.style.color = '#FFFFFF'
        const ic = document.createElement('atoll-icon')
        ic.setAttribute('name', 'user')
        ic.setAttribute('size', '14')
        span.appendChild(ic)
        slot4.appendChild(span)
      })
      mp4.appendChild(slot4)
      multipartySection.appendChild(mp4)

      const groupedSection = document.getElementById('section-grouped')
      const row = document.createElement('div')
      row.className = 'atoll-profile-group-row'

      const p1 = document.createElement('atoll-profile')
      p1.setAttribute('size', 'lg')
      p1.setAttribute('name', 'Alice Smith')
      row.appendChild(p1)

      const p2 = document.createElement('atoll-profile')
      p2.setAttribute('size', 'lg')
      p2.setAttribute('name', 'Bob Jones')
      row.appendChild(p2)

      const p3 = document.createElement('atoll-profile')
      p3.setAttribute('size', 'lg')
      p3.setAttribute('name', 'Charlie Brown')
      row.appendChild(p3)

      groupedSection.appendChild(row)
    })

    await page.waitForTimeout(2000)
    await page.screenshot({
      path: 'tests/e2e/screenshots/profile-verification.png'
    })
  })

  test('should support grouped overlapping style inside timeline seenIndicators', async ({ page }) => {
    // Inject a timeline-row element with seenUserIds / seenAvatars to verify its inner structure
    await page.evaluate(() => {
      document.body.innerHTML = ''
      const row = document.createElement('timeline-row')
      row.id = 'test-timeline-row'
      row.setAttribute('is-sent', 'true')
      row.setAttribute('seen-user-ids', 'uid1,uid2')
      document.body.appendChild(row)
    })

    const row = page.locator('#test-timeline-row')
    await expect(row).toBeVisible()

    // Query seen indicators container
    const seenContainer = row.locator('.seen-indicators')
    await expect(seenContainer).toBeVisible()
    await expect(seenContainer).toHaveClass(/d-flex/)
    await expect(seenContainer).toHaveClass(/justify-content-end/)

    // Ensure the profiles are nested inside an atoll-profile-group-row wrapper
    const groupRow = seenContainer.locator('.atoll-profile-group-row')
    await expect(groupRow).toBeVisible()

    const profiles = groupRow.locator('atoll-profile')
    await expect(profiles).toHaveCount(2)

    // Now test a received message row (should justify-content-start)
    await page.evaluate(() => {
      const row = document.getElementById('test-timeline-row')
      row.setAttribute('is-sent', 'false')
    })

    await expect(seenContainer).toHaveClass(/justify-content-start/)
  })
})
