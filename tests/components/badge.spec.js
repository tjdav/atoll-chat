import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-badge Component Tests', () => {
  test('should render basic count and truncate correctly at threshold', async ({ page, mountComponent }) => {
    await mountComponent('atoll-badge', {
      count: '5'
    })

    const badgeHost = page.locator('#test-component-root')
    const innerBadge = badgeHost.locator('.atoll-badge')

    await expect(badgeHost).toBeVisible()
    await expect(innerBadge).toHaveText('5')
    await expect(badgeHost).toHaveAttribute('role', 'status')
    await expect(badgeHost).toHaveAttribute('aria-label', '5 unread messages')

    // Truncate logic at 99+
    await badgeHost.evaluate(el => el.setAttribute('count', '150'))
    await expect(innerBadge).toHaveText('99+')
    await expect(badgeHost).toHaveAttribute('aria-label', '99+ unread messages')

    // Custom max-count="999"
    await badgeHost.evaluate(el => el.setAttribute('max-count', '999'))
    await expect(innerBadge).toHaveText('150')
    await expect(badgeHost).toHaveAttribute('aria-label', '150 unread messages')
  })

  test('should support dot mode and dimensions', async ({ page, mountComponent }) => {
    await mountComponent('atoll-badge', {
      dot: 'true'
    })

    const badgeHost = page.locator('#test-component-root')
    const innerBadge = badgeHost.locator('.atoll-badge')

    await expect(badgeHost).toBeVisible()
    await expect(innerBadge).toHaveText('')
    await expect(badgeHost).toHaveAttribute('role', 'status')
    await expect(badgeHost).toHaveAttribute('aria-label', 'New notification')

    const box = await innerBadge.boundingBox()
    expect(box.width).toBe(8)
    expect(box.height).toBe(8)
  })

  test('should auto-hide for zero or null counts and show when show-zero is true', async ({ page, mountComponent }) => {
    await mountComponent('atoll-badge', {
      count: '0'
    })

    const badgeHost = page.locator('#test-component-root')
    const innerBadge = badgeHost.locator('.atoll-badge')

    await expect(badgeHost).toBeHidden()
    await expect(badgeHost).toHaveAttribute('hidden', '')
    await expect(badgeHost).toHaveAttribute('aria-hidden', 'true')

    await badgeHost.evaluate(el => el.setAttribute('show-zero', 'true'))
    await expect(badgeHost).toBeVisible()
    await expect(innerBadge).toHaveText('0')

    await badgeHost.evaluate(el => el.removeAttribute('count'))
    await expect(badgeHost).toBeHidden()
  })

  test('should support text/tag label mode and size scale', async ({ page, mountComponent }) => {
    await mountComponent('atoll-badge', {
      label: 'BOT',
      variant: 'secondary',
      size: 'sm'
    })

    const badgeHost = page.locator('#test-component-root')
    const innerBadge = badgeHost.locator('.atoll-badge')

    await expect(innerBadge).toHaveText('BOT')
    await expect(innerBadge).toHaveCSS('height', '16px')
    await expect(badgeHost).toHaveAttribute('aria-label', 'BOT')

    await badgeHost.evaluate(el => el.setAttribute('size', 'lg'))
    await expect(innerBadge).toHaveCSS('height', '24px')
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
      title.textContent = 'atoll-badge Visual Verification Matrix'
      matrix.appendChild(title)

      // Section 1: Variants with Counts
      const variantRow = document.createElement('div')
      variantRow.style.cssText = 'display: flex; align-items: center; gap: 16px;'
      ;['danger', 'primary', 'secondary', 'info', 'warning'].forEach(variant => {
        const badge = document.createElement('atoll-badge')
        badge.setAttribute('variant', variant)
        badge.setAttribute('count', '8')
        variantRow.appendChild(badge)
      })
      matrix.appendChild(variantRow)

      // Section 2: Sizing Scale & Truncation
      const sizeRow = document.createElement('div')
      sizeRow.style.cssText = 'display: flex; align-items: center; gap: 16px;'

      const dotBadge = document.createElement('atoll-badge')
      dotBadge.setAttribute('dot', 'true')

      const smBadge = document.createElement('atoll-badge')
      smBadge.setAttribute('size', 'sm')
      smBadge.setAttribute('count', '3')

      const mdBadge = document.createElement('atoll-badge')
      mdBadge.setAttribute('size', 'md')
      mdBadge.setAttribute('count', '42')

      const lgBadge = document.createElement('atoll-badge')
      lgBadge.setAttribute('size', 'lg')
      lgBadge.setAttribute('count', '150')

      sizeRow.appendChild(dotBadge)
      sizeRow.appendChild(smBadge)
      sizeRow.appendChild(mdBadge)
      sizeRow.appendChild(lgBadge)
      matrix.appendChild(sizeRow)

      // Section 3: Text Label Badges
      const labelRow = document.createElement('div')
      labelRow.style.cssText = 'display: flex; align-items: center; gap: 16px;'

      const botBadge = document.createElement('atoll-badge')
      botBadge.setAttribute('label', 'BOT')
      botBadge.setAttribute('variant', 'secondary')
      botBadge.setAttribute('size', 'sm')

      const newBadge = document.createElement('atoll-badge')
      newBadge.setAttribute('label', 'NEW')
      newBadge.setAttribute('variant', 'primary')
      newBadge.setAttribute('size', 'sm')

      labelRow.appendChild(botBadge)
      labelRow.appendChild(newBadge)
      matrix.appendChild(labelRow)

      mountPoint.appendChild(matrix)
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('badge-verification-light', matrix)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('badge-verification-dark', matrix)
  })
})
