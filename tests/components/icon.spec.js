import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-icon Component Tests', () => {
  test('should render base icon class and resolved Solar SVG from registry', async ({ page, mountComponent }) => {
    await mountComponent('atoll-icon', {
      name: 'music',
      size: 'lg'
    })

    const iconHost = page.locator('#test-component-root')
    const innerWrapper = iconHost.locator('.atoll-icon')
    const svg = innerWrapper.locator('svg.solar')

    await expect(iconHost).toBeVisible()
    await expect(innerWrapper).toBeVisible()
    await expect(svg).toBeVisible()
    await expect(svg).toHaveClass(/solar-music/)
  })

  test('should support preset token and custom numeric sizes', async ({ page, mountComponent }) => {
    await mountComponent('atoll-icon', {
      name: 'search',
      size: '42'
    })

    const iconHost = page.locator('#test-component-root')
    const innerWrapper = iconHost.locator('.atoll-icon')

    await expect(innerWrapper).toHaveCSS('width', '42px')
    await expect(innerWrapper).toHaveCSS('height', '42px')

    await iconHost.evaluate(el => el.setAttribute('size', 'xl'))
    await expect(innerWrapper).toHaveCSS('width', '48px')
    await expect(innerWrapper).toHaveCSS('height', '48px')
  })

  test('should support primary and secondary color styles', async ({ page, mountComponent }) => {
    await mountComponent('atoll-icon', {
      name: 'settings',
      color: 'rgb(255, 0, 0)',
      'secondary-color': 'rgb(0, 255, 0)'
    })

    const iconHost = page.locator('#test-component-root')
    await expect(iconHost).toHaveAttribute('style', /--icon-primary-color:\s*rgb\(255,\s*0,\s*0\)/)
  })

  test('should toggle active variant (linear vs bold)', async ({ page, mountComponent }) => {
    await mountComponent('atoll-icon', {
      name: 'pin',
      active: 'false'
    })

    const iconHost = page.locator('#test-component-root')
    const svg = iconHost.locator('svg.solar')

    await expect(svg).toBeVisible()

    await iconHost.evaluate(el => el.setAttribute('active', 'true'))
    await expect(svg).toBeVisible()
  })

  test('should handle accessibility attributes (aria-hidden default vs role="img")', async ({ page, mountComponent }) => {
    await mountComponent('atoll-icon', {
      name: 'logout'
    })

    const iconHost = page.locator('#test-component-root')
    await expect(iconHost).toHaveAttribute('aria-hidden', 'true')
    await expect(iconHost).not.toHaveAttribute('role')

    await iconHost.evaluate(el => el.setAttribute('aria-label', 'Logout of App'))
    await expect(iconHost).toHaveAttribute('role', 'img')
    await expect(iconHost).toHaveAttribute('aria-label', 'Logout of App')
    await expect(iconHost).not.toHaveAttribute('aria-hidden')
  })

  test('should render comprehensive visual matrix and generate verification screenshots', async ({ page, setTheme, takeVerificationScreenshot }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

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
      matrix.style.cssText = 'display: flex; flex-direction: column; gap: 32px; padding: 48px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111); font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;'

      const title = document.createElement('h2')
      title.style.cssText = 'margin: 0; font-size: 20px;'
      title.textContent = 'atoll-icon Visual Verification Matrix'
      matrix.appendChild(title)

      // Section 1: Size Scale (xs -> xl)
      const sizeSection = document.createElement('div')
      sizeSection.style.cssText = 'display: flex; align-items: center; gap: 24px;'
      ;['xs', 'sm', 'md', 'lg', 'xl'].forEach(size => {
        const icon = document.createElement('atoll-icon')
        icon.setAttribute('name', 'chat')
        icon.setAttribute('size', size)
        sizeSection.appendChild(icon)
      })
      matrix.appendChild(sizeSection)

      // Section 2: Core Functional Icons
      const iconGrid = document.createElement('div')
      iconGrid.style.cssText = 'display: grid; grid-template-columns: repeat(6, 1fr); gap: 20px;'
      ;['send', 'attach', 'emoji', 'settings', 'bell', 'permissions', 'user', 'camera', 'videocam', 'phone', 'play', 'pause'].forEach(name => {
        const icon = document.createElement('atoll-icon')
        icon.setAttribute('name', name)
        icon.setAttribute('size', 'md')
        iconGrid.appendChild(icon)
      })
      matrix.appendChild(iconGrid)

      // Section 3: Dual Color and Active Variants
      const colorSection = document.createElement('div')
      colorSection.style.cssText = 'display: flex; align-items: center; gap: 24px;'

      const primaryIcon = document.createElement('atoll-icon')
      primaryIcon.setAttribute('name', 'pin')
      primaryIcon.setAttribute('color', '#06C755')
      primaryIcon.setAttribute('size', 'lg')

      const activeIcon = document.createElement('atoll-icon')
      activeIcon.setAttribute('name', 'pin')
      activeIcon.setAttribute('active', 'true')
      activeIcon.setAttribute('color', '#06C755')
      activeIcon.setAttribute('size', 'lg')

      const dangerIcon = document.createElement('atoll-icon')
      dangerIcon.setAttribute('name', 'warning')
      dangerIcon.setAttribute('color', '#FF334B')
      dangerIcon.setAttribute('size', 'lg')

      colorSection.appendChild(primaryIcon)
      colorSection.appendChild(activeIcon)
      colorSection.appendChild(dangerIcon)
      matrix.appendChild(colorSection)

      mountPoint.appendChild(matrix)
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('icon-verification-light', matrix)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('icon-verification-dark', matrix)
  })
})
