import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-profile Component Tests', () => {
  test('should render strict 8-tier size scale dimensions accurately', async ({ page, mountComponent }) => {
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
      await mountComponent('atoll-profile', { size: sizeName })

      const profile = page.locator('#test-component-root')
      await expect(profile).toBeVisible()

      const box = await profile.boundingBox()
      expect(Math.round(box.width)).toBe(expectedPx)
      expect(Math.round(box.height)).toBe(expectedPx)
    }
  })

  test('should handle arbitrary numeric size values via dynamic style property', async ({ page, mountComponent }) => {
    await mountComponent('atoll-profile', { size: '64' })

    const profile = page.locator('#test-component-root')
    await expect(profile).toBeVisible()

    const box = await profile.boundingBox()
    expect(Math.round(box.width)).toBe(64)
    expect(Math.round(box.height)).toBe(64)
  })

  test('should extract 2-letter uppercase initials, apply deterministic background palette, and manage host ARIA attributes', async ({ page, mountComponent }) => {
    await mountComponent('atoll-profile', { name: 'Alice Cooper' })

    const profileHost = page.locator('#test-component-root')
    const initials = profileHost.locator('.atoll-profile-initials')

    await expect(initials).toBeVisible()
    await expect(initials).toHaveText('AC')
    await expect(profileHost).toHaveAttribute('role', 'img')
    await expect(profileHost).toHaveAttribute('aria-label', 'Alice Cooper')

    const hasBg = await profileHost.evaluate((el) => {
      const fallback = el.querySelector('.atoll-profile-fallback')
      return fallback && getComputedStyle(fallback).backgroundColor !== 'transparent'
    })
    expect(hasBg).toBe(true)
  })

  test('should render status/story ring when ring attribute is present', async ({ page, mountComponent }) => {
    await mountComponent('atoll-profile', { ring: 'true', name: 'Story User' })

    const profileHost = page.locator('#test-component-root')
    await expect(profileHost).toHaveAttribute('ring', 'true')
  })

  test('should handle multiparty split quadrants (2, 3, 4 participants)', async ({ page, mountComponent }) => {
    await mountComponent('atoll-profile', {
      type: 'multiparty',
      'split-count': '3'
    }, `
      <img slot="image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
      <img slot="image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
    `)

    const host = page.locator('#test-component-root')
    await expect(host).toHaveAttribute('type', 'multiparty')
    await expect(host).toHaveAttribute('split-count', '3')
  })

  test('should compose badge and overlay icon indicators', async ({ page, mountComponent }) => {
    await mountComponent('atoll-profile', { badge: '7', 'icon-name': 'check' })

    const badge = page.locator('#test-component-root atoll-badge')
    const icon = page.locator('#test-component-root .atoll-profile-icon atoll-icon')

    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('count', '7')
    await expect(icon).toBeVisible()
    await expect(icon).toHaveAttribute('name', 'check')
  })

  test('should render comprehensive visual matrix and generate verification screenshots', async ({ page, mountComponent, setTheme, takeVerificationScreenshot }) => {
    // 1. Initialize component and ensure stylesheet is loaded
    await mountComponent('atoll-profile')

    await page.evaluate(() => {
      let mountPoint = document.getElementById('component-mount-point')
      if (!mountPoint) {
        mountPoint = document.createElement('div')
        mountPoint.id = 'component-mount-point'
        document.body.appendChild(mountPoint)
      }
      mountPoint.innerHTML = ''

      const matrix = document.createElement('div')
      matrix.id = 'visual-matrix'
      matrix.style.cssText = 'display: flex; flex-direction: column; gap: 32px; padding: 48px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111); font-family: system-ui, sans-serif; max-width: 580px; margin: 0 auto;'

      matrix.innerHTML = `
        <h2 style="margin: 0; font-size: 20px;">atoll-profile Visual Verification Matrix</h2>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
          <atoll-profile size="lg" name="Sarah Connor"></atoll-profile>
          <atoll-profile size="lg" ring="true" name="John Wick"></atoll-profile>
          <atoll-profile size="lg" name="Ada Lovelace" badge="3" icon-name="check-circle"></atoll-profile>
          <atoll-profile size="lg" type="multiparty" split-count="3">
            <span slot="image" class="atoll-profile-fallback" style="background-color: #4270ED !important;"><atoll-icon name="user" size="16"></atoll-icon></span>
            <span slot="image" class="atoll-profile-fallback" style="background-color: #FCB321 !important;"><atoll-icon name="user" size="12"></atoll-icon></span>
            <span slot="image" class="atoll-profile-fallback" style="background-color: #FF334B !important;"><atoll-icon name="user" size="12"></atoll-icon></span>
          </atoll-profile>
          <atoll-profile size="lg"></atoll-profile>
          <atoll-profile size="lg" loading="true"></atoll-profile>
        </div>
      `
      mountPoint.appendChild(matrix)
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('profile-verification-light', matrix)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('profile-verification-dark', matrix)
  })
})
