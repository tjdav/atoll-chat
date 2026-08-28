import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-button Component Tests', () => {
  test('should render base button with default attributes and slots', async ({ page, mountComponent }) => {
    await mountComponent('atoll-button', {}, 'Click Me')
    const buttonHost = page.locator('#test-component-root')
    const innerBtn = buttonHost.locator('button')
    const label = buttonHost.locator('.atoll-btn-label')

    await expect(buttonHost).toBeVisible()
    await expect(innerBtn).toHaveClass('atoll-btn')
    await expect(label).toContainText('Click Me')
    await expect(innerBtn).toHaveCSS('height', '44px') // md default height
  })

  test('should support host attribute modifiers for variants and sizes', async ({ page, mountComponent }) => {
    await mountComponent('atoll-button', { variant: 'danger', size: 'lg', block: 'true', pill: 'true' }, 'Action')
    const buttonHost = page.locator('#test-component-root')
    const innerBtn = buttonHost.locator('button')

    await expect(buttonHost).toBeVisible()
    await expect(innerBtn).toHaveCSS('height', '44px') // lg pill height
    await expect(innerBtn).toHaveCSS('border-radius', '9999px') // Pill shape border radius
  })

  test('should apply pill compact sizing and 44px touch target expansion', async ({ page, mountComponent }) => {
    await mountComponent('atoll-button', { pill: 'true', size: 'sm' }, 'Small Pill')
    const innerBtn = page.locator('#test-component-root button')

    await expect(innerBtn).toHaveCSS('height', '28px')
    await expect(innerBtn).toHaveCSS('padding-left', '12px')
    await expect(innerBtn).toHaveCSS('padding-right', '12px')

    const touchTargetBox = await innerBtn.evaluate((el) => {
      const style = window.getComputedStyle(el, '::before')
      return {
        content: style.getPropertyValue('content'),
        minHeight: style.getPropertyValue('min-height')
      }
    })
    expect(touchTargetBox.content).toBe('""')
    expect(touchTargetBox.minHeight).toBe('44px')
  })

  test('should prevent click events when disabled', async ({ page, mountComponent }) => {
    await mountComponent('atoll-button', { disabled: 'true' }, 'Cannot Click')
    const buttonHost = page.locator('#test-component-root')
    const innerBtn = buttonHost.locator('button')

    await page.evaluate(() => {
      window.__btnClicked = false
      document.getElementById('test-component-root').addEventListener('click', () => {
        window.__btnClicked = true
      })
    })

    await innerBtn.click({ force: true })
    const clicked = await page.evaluate(() => window.__btnClicked)
    expect(clicked).toBe(false)
  })

  test('should support dynamic spinner loading states', async ({ page, mountComponent }) => {
    await mountComponent('atoll-button', { loading: 'true', 'spinner-variant': 'light' }, 'Save')
    const innerBtn = page.locator('#test-component-root button')

    await expect(innerBtn).toBeDisabled()
    await expect(innerBtn.locator('.atoll-btn-spinner')).toBeVisible()
    const content = innerBtn.locator('.atoll-btn-content')
    await expect(content).toHaveCSS('opacity', '0')
  })

  test('should support leadingIcon, trailingIcon, and text attributes programmatically', async ({ page, mountComponent }) => {
    await mountComponent('atoll-button', { 'leading-icon': 'settings', 'trailing-icon': 'arrow-right', text: 'Attribute Text' })
    const buttonHost = page.locator('#test-component-root')

    const leadingIcon = buttonHost.locator('.atoll-btn-leading atoll-icon')
    await expect(leadingIcon).toBeVisible()
    await expect(leadingIcon).toHaveAttribute('name', 'settings')

    const trailingIcon = buttonHost.locator('.atoll-btn-trailing atoll-icon')
    await expect(trailingIcon).toBeVisible()
    await expect(trailingIcon).toHaveAttribute('name', 'arrow-right')

    const label = buttonHost.locator('.atoll-btn-label')
    await expect(label).toContainText('Attribute Text')
  })

  test('should render comprehensive visual matrix and generate verification screenshots', async ({ page, setTheme, takeVerificationScreenshot }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    await page.evaluate(() => {
      document.body.innerHTML = `
        <div id="visual-matrix" style="display: flex; flex-direction: column; gap: 24px; padding: 32px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111); font-family: system-ui, sans-serif;">
          <h2 style="margin: 0; font-size: 20px;">atoll-button Visual Verification Matrix</h2>
          
          <div>
            <div style="font-weight: 600; margin-bottom: 8px;">Variants</div>
            <div style="display: flex; gap: 12px; flex-wrap: wrap;">
              <atoll-button variant="primary">Primary</atoll-button>
              <atoll-button variant="secondary">Secondary</atoll-button>
              <atoll-button variant="outline">Outline</atoll-button>
              <atoll-button variant="ghost">Ghost</atoll-button>
              <atoll-button variant="danger">Danger</atoll-button>
              <atoll-button variant="info">Info</atoll-button>
              <atoll-button variant="link">Link</atoll-button>
            </div>
          </div>

          <div>
            <div style="font-weight: 600; margin-bottom: 8px;">Sizes & Pill Shapes</div>
            <div style="display: flex; gap: 12px; align-items: center;">
              <atoll-button size="sm">Small (32px)</atoll-button>
              <atoll-button size="md">Medium (44px)</atoll-button>
              <atoll-button size="lg">Large (52px)</atoll-button>
              <atoll-button size="sm" pill="true">Pill SM (28px)</atoll-button>
              <atoll-button size="md" pill="true">Pill MD (36px)</atoll-button>
              <atoll-button size="lg" pill="true">Pill LG (44px)</atoll-button>
            </div>
          </div>

          <div>
            <div style="font-weight: 600; margin-bottom: 8px;">Icon-Only & States</div>
            <div style="display: flex; gap: 12px; align-items: center;">
              <atoll-button icon-only="true" aria-label="Search"><atoll-icon name="search" size="20"></atoll-icon></atoll-button>
              <atoll-button icon-only="true" pill="true" aria-label="Add"><atoll-icon name="add" size="20"></atoll-icon></atoll-button>
              <atoll-button disabled="true">Disabled</atoll-button>
              <atoll-button loading="true" spinner-variant="light">Loading</atoll-button>
            </div>
          </div>
        </div>
      `
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light theme verification screenshot
    await setTheme('light')
    await takeVerificationScreenshot('btn-verification-light', matrix)

    // Dark theme verification screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('btn-verification-dark', matrix)
  })
})
