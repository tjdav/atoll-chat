import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-card Component Tests', () => {
  test('should render card with default attributes, title/subtitle, and body slot', async ({ page, mountComponent }) => {
    await mountComponent('atoll-card', { title: 'Card Title', subtitle: 'Card Subtitle' }, 'Body Content')
    const cardHost = page.locator('#test-component-root')
    const body = cardHost.locator('.atoll-card-body')
    const header = cardHost.locator('.atoll-card-header')
    const title = cardHost.locator('.atoll-card-title')
    const subtitle = cardHost.locator('.atoll-card-subtitle')

    await expect(cardHost).toBeVisible()
    await expect(body).toContainText('Body Content')
    await expect(header).toBeVisible()
    await expect(title).toHaveText('Card Title')
    await expect(subtitle).toHaveText('Card Subtitle')
  })

  test('should support computed slots and omit header/footer wrapper markup when empty or hidden', async ({ page, mountComponent }) => {
    await mountComponent('atoll-card', {}, 'Only Body')
    const cardHost = page.locator('#test-component-root')

    // Header and footer containers should not exist in DOM when empty
    await expect(cardHost.locator('.atoll-card-header')).toHaveCount(0)
    await expect(cardHost.locator('.atoll-card-footer')).toHaveCount(0)

    // Mount card with custom header and footer slots
    await page.evaluate(() => {
      const mountPoint = document.getElementById('component-mount-point')
      mountPoint.innerHTML = `
        <atoll-card id="test-component-root">
          <div slot="header" id="custom-header">Header Slot</div>
          <div>Card Body Content</div>
          <div slot="footer" id="custom-footer">Footer Slot</div>
        </atoll-card>
      `
    })

    const customHeaderWrapper = cardHost.locator('.atoll-card-header')
    const customFooterWrapper = cardHost.locator('.atoll-card-footer')
    await expect(customHeaderWrapper).toBeVisible()
    await expect(customHeaderWrapper).toContainText('Header Slot')
    await expect(customFooterWrapper).toBeVisible()
    await expect(customFooterWrapper).toContainText('Footer Slot')

    // Hide header and footer via attributes and verify wrapper removal
    await page.evaluate(() => {
      const card = document.getElementById('test-component-root')
      card.setAttribute('hide-header', 'true')
      card.setAttribute('hide-footer', 'true')
    })

    await expect(cardHost.locator('.atoll-card-header')).toHaveCount(0)
    await expect(cardHost.locator('.atoll-card-footer')).toHaveCount(0)
  })

  test('should support attribute modifiers for shadow, rounded, border, body-padding, and center', async ({ page, mountComponent }) => {
    await mountComponent('atoll-card', {
      shadow: 'lg',
      rounded: 'lg',
      border: 'none',
      'body-padding': 'sm',
      center: 'true'
    }, 'Centered Content')

    const cardHost = page.locator('#test-component-root')
    const body = cardHost.locator('.atoll-card-body')

    await expect(cardHost).toHaveAttribute('shadow', 'lg')
    await expect(cardHost).toHaveAttribute('rounded', 'lg')
    await expect(cardHost).toHaveAttribute('border', 'none')
    await expect(cardHost).toHaveAttribute('body-padding', 'sm')
    await expect(body).toHaveCSS('text-align', 'center')
  })

  test('should support responsive fullscreen breakpoint styles across viewport sizes', async ({ page, mountComponent }) => {
    await mountComponent('atoll-card', { fullscreen: 'md' }, 'Responsive Fullscreen')
    const cardHost = page.locator('#test-component-root')

    // At 1000px viewport (above md breakpoint 767.98px), card is not fullscreen (default width 450px)
    await page.setViewportSize({ width: 1000, height: 800 })
    await expect(cardHost).toHaveCSS('width', '450px')

    // At 600px viewport (below md breakpoint 767.98px), card becomes fullscreen (100vw = 600px)
    await page.setViewportSize({ width: 600, height: 800 })
    await expect(cardHost).toHaveCSS('width', '600px')

    // Test fullscreen="always"
    await page.evaluate(() => {
      const card = document.getElementById('test-component-root')
      card.setAttribute('fullscreen', 'always')
    })
    await page.setViewportSize({ width: 1200, height: 800 })
    await expect(cardHost).toHaveCSS('width', '1200px')
  })

  test('should render comprehensive visual matrix and generate verification screenshots', async ({ page, setTheme, takeVerificationScreenshot }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    await page.evaluate(() => {
      document.body.innerHTML = `
        <div id="visual-matrix" style="display: flex; flex-direction: column; gap: 24px; padding: 32px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111); font-family: system-ui, sans-serif;">
          <h2 style="margin: 0; font-size: 20px;">atoll-card Visual Verification Matrix</h2>
          
          <div style="display: flex; gap: 24px; flex-wrap: wrap;">
            <!-- Basic Title / Subtitle Card -->
            <atoll-card title="Standard Card" subtitle="Card Subtitle" shadow="sm">
              <div>This is standard card content with title and subtitle headers.</div>
            </atoll-card>

            <!-- Custom Slotted Header & Footer Card -->
            <atoll-card shadow="lg" rounded="lg">
              <div slot="header" style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 600; font-size: 16px;">Custom Header</span>
                <span style="font-size: 12px; opacity: 0.7;">Badge</span>
              </div>
              <div>Custom header and footer slotted card content.</div>
              <div slot="footer" style="display: flex; justify-content: flex-end; gap: 8px;">
                <button type="button" style="padding: 6px 12px;">Cancel</button>
                <button type="button" style="padding: 6px 12px; background: var(--atoll-brand-primary, #047835); color: #fff; border: none; border-radius: 4px;">Confirm</button>
              </div>
            </atoll-card>

            <!-- Centered & Borderless Card -->
            <atoll-card center="true" border="none" shadow="xl" body-padding="sm">
              <div style="font-weight: 600; margin-bottom: 8px;">Centered & Borderless</div>
              <div>Card content aligned to center with extra padding and xl shadow.</div>
            </atoll-card>
          </div>
        </div>
      `
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light theme verification screenshot
    await setTheme('light')
    await takeVerificationScreenshot('card-verification-light', matrix)

    // Dark theme verification screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('card-verification-dark', matrix)
  })
})
