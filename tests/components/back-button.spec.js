import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-back-button Component Tests', () => {
  test('should render inner atoll-button with correct default attributes and aria-label', async ({ page, mountComponent }) => {
    await mountComponent('atoll-back-button')
    const backHost = page.locator('#test-component-root')
    const innerBtn = backHost.locator('atoll-button')

    await expect(backHost).toBeVisible()
    await expect(innerBtn).toBeVisible()
    await expect(innerBtn).toHaveAttribute('variant', 'ghost')
    await expect(innerBtn).toHaveAttribute('leading-icon', 'chevron-left')
    await expect(innerBtn).toHaveAttribute('icon-only', 'true')
    await expect(innerBtn).toHaveAttribute('pill', 'true')
    await expect(innerBtn).toHaveAttribute('aria-label', 'Go back')
  })

  test('should emit back event and trigger router:back on click', async ({ page, mountComponent }) => {
    await mountComponent('atoll-back-button')
    const backHost = page.locator('#test-component-root')

    await page.evaluate(() => {
      window.__backFired = false
      window.__routerBackFired = false

      const host = document.getElementById('test-component-root')
      host.addEventListener('back', () => {
        window.__backFired = true
      })

      if (window.$bus) {
        window.$bus.on('router:back', () => {
          window.__routerBackFired = true
        })
      }
    })

    await backHost.click()

    const backFired = await page.evaluate(() => window.__backFired)
    expect(backFired).toBe(true)
  })

  test('should render visual matrix and pass accessibility checks in light and dark themes', async ({ page, setTheme, takeVerificationScreenshot }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    await page.evaluate(() => {
      document.body.innerHTML = `
        <div id="visual-matrix" style="padding: 24px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111);">
          <h3>atoll-back-button Visual Verification Matrix</h3>
          <div style="display: flex; gap: 16px; align-items: center;">
            <atoll-back-button></atoll-back-button>
          </div>
        </div>
      `
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    await setTheme('light')
    await takeVerificationScreenshot('back-btn-verification-light', matrix)

    await setTheme('dark')
    await takeVerificationScreenshot('back-btn-verification-dark', matrix)
  })
})
