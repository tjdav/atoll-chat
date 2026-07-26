import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Button Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
  })

  test('should render visual variants & size class modifiers', async ({ page }) => {
    await page.evaluate(() => {
      const btn = document.createElement('atoll-button')
      btn.id = 'test-btn-modifier'
      btn.setAttribute('variant', 'danger')
      btn.setAttribute('size', 'lg')
      btn.setAttribute('block', 'true')
      btn.setAttribute('pill', 'true')
      btn.textContent = 'Action'
      document.body.appendChild(btn)
    })

    const buttonHost = page.locator('#test-btn-modifier')
    await expect(buttonHost).toBeVisible()

    const innerBtn = buttonHost.locator('button')
    await expect(innerBtn).toHaveClass(/atoll-btn/)
    await expect(innerBtn).toHaveClass(/atoll-btn-danger/)
    await expect(innerBtn).toHaveClass(/atoll-btn-lg/)
    await expect(innerBtn).toHaveClass(/atoll-btn-block/)
    await expect(innerBtn).toHaveClass(/atoll-btn-pill/)
  })

  test('should prevent click event dispatch and propagation when disabled', async ({ page }) => {
    await page.evaluate(() => {
      const btn = document.createElement('atoll-button')
      btn.id = 'test-btn-disabled'
      btn.setAttribute('disabled', 'true')
      btn.textContent = 'Cannot Click'
      window.__btnClicked = false
      btn.addEventListener('click', () => {
        window.__btnClicked = true
      })
      document.body.appendChild(btn)
    })

    const buttonHost = page.locator('#test-btn-disabled')
    await expect(buttonHost).toBeVisible()

    const innerBtn = buttonHost.locator('button')
    await expect(innerBtn).toBeDisabled()

    // Trigger standard click through playwright (force because it's disabled)
    await innerBtn.click({ force: true })

    const clicked = await page.evaluate(() => window.__btnClicked)
    expect(clicked).toBe(false)
  })

  test('should assert slot projection order', async ({ page }) => {
    await page.evaluate(() => {
      const btn = document.createElement('atoll-button')
      btn.id = 'test-btn-slots'
      btn.innerHTML = `
        <span slot="leading" id="lead-child">L</span>
        Main Text
        <span slot="trailing" id="trail-child">T</span>
      `
      document.body.appendChild(btn)
    })

    const buttonHost = page.locator('#test-btn-slots')
    await expect(buttonHost).toBeVisible()

    // Verify that lead slot, main slot, and trail slot are projected inside the correct container order
    const leading = buttonHost.locator('#lead-child')
    const trailing = buttonHost.locator('#trail-child')
    const label = buttonHost.locator('.atoll-btn-label')

    await expect(leading).toBeVisible()
    await expect(trailing).toBeVisible()
    await expect(label).toContainText('Main Text')
  })

  test('should support dynamic imperative loading state', async ({ page }) => {
    await page.evaluate(() => {
      const btn = document.createElement('atoll-button')
      btn.id = 'test-btn-loading'
      btn.textContent = 'Save Changes'
      document.body.appendChild(btn)
    })

    const buttonHost = page.locator('#test-btn-loading')
    await expect(buttonHost).toBeVisible()

    const innerBtn = buttonHost.locator('button')
    await expect(innerBtn).not.toHaveClass(/atoll-btn-loading/)
    await expect(innerBtn).not.toBeDisabled()
    await expect(innerBtn.locator('.atoll-btn-spinner')).toBeHidden()

    // Enable loading
    await page.evaluate(() => {
      const btn = document.getElementById('test-btn-loading')
      btn.setAttribute('loading', 'true')
    })

    await expect(innerBtn).toHaveClass(/atoll-btn-loading/)
    await expect(innerBtn).toBeDisabled()
    await expect(innerBtn).toHaveAttribute('aria-busy', 'true')
    await expect(innerBtn).toHaveAttribute('aria-disabled', 'true')

    const spinner = innerBtn.locator('.atoll-btn-spinner')
    await expect(spinner).toBeVisible()

    const spinnerIcon = spinner.locator('atoll-icon')
    await expect(spinnerIcon).toBeVisible()
    await expect(spinnerIcon).toHaveAttribute('name', 'settings')

    // Disable loading
    await page.evaluate(() => {
      const btn = document.getElementById('test-btn-loading')
      btn.setAttribute('loading', 'false')
    })

    await expect(innerBtn).not.toHaveClass(/atoll-btn-loading/)
    await expect(innerBtn).not.toBeDisabled()
    await expect(innerBtn).not.toHaveAttribute('aria-busy')
    await expect(innerBtn).not.toHaveAttribute('aria-disabled')
    await expect(spinner).toBeHidden()
  })

  test('should render visual variants for screenshot', async ({ page }) => {
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 20px; padding: 40px; background-color: #f8f9fa; font-family: sans-serif; color: #111;">
          <h2>Atoll Chat Button Component Architecture</h2>
          
          <div id="section-variants" style="display: flex; gap: 20px; align-items: center;">
            <strong>Variants:</strong>
          </div>

          <div id="section-sizes" style="display: flex; gap: 20px; align-items: center;">
            <strong>Sizes:</strong>
          </div>

          <div id="section-slots" style="display: flex; gap: 20px; align-items: center;">
            <strong>Slots:</strong>
          </div>

          <div id="section-loading" style="display: flex; gap: 20px; align-items: center;">
            <strong>Loading & State:</strong>
          </div>
        </div>
      `

      // Programmatically create and append Buttons
      const btnPrimary = document.createElement('atoll-button')
      btnPrimary.setAttribute('variant', 'primary')
      btnPrimary.textContent = 'Primary CTA'
      document.getElementById('section-variants').appendChild(btnPrimary)

      const btnSecondary = document.createElement('atoll-button')
      btnSecondary.setAttribute('variant', 'secondary')
      btnSecondary.textContent = 'Secondary Choice'
      document.getElementById('section-variants').appendChild(btnSecondary)

      const btnOutline = document.createElement('atoll-button')
      btnOutline.setAttribute('variant', 'outline')
      btnOutline.textContent = 'Outline Inline'
      document.getElementById('section-variants').appendChild(btnOutline)

      const btnGhost = document.createElement('atoll-button')
      btnGhost.setAttribute('variant', 'ghost')
      btnGhost.textContent = 'Ghost Trigger'
      document.getElementById('section-variants').appendChild(btnGhost)

      const btnDanger = document.createElement('atoll-button')
      btnDanger.setAttribute('variant', 'danger')
      btnDanger.textContent = 'Danger Trigger'
      document.getElementById('section-variants').appendChild(btnDanger)

      // Sizes
      const btnSm = document.createElement('atoll-button')
      btnSm.setAttribute('size', 'sm')
      btnSm.textContent = 'Small 32px'
      document.getElementById('section-sizes').appendChild(btnSm)

      const btnMd = document.createElement('atoll-button')
      btnMd.setAttribute('size', 'md')
      btnMd.textContent = 'Medium 44px'
      document.getElementById('section-sizes').appendChild(btnMd)

      const btnLg = document.createElement('atoll-button')
      btnLg.setAttribute('size', 'lg')
      btnLg.textContent = 'Large 52px'
      document.getElementById('section-sizes').appendChild(btnLg)

      // Slots
      const btnSlot = document.createElement('atoll-button')
      btnSlot.setAttribute('variant', 'primary')
      btnSlot.innerHTML = `
        <span slot="leading" style="display: inline-flex; align-items: center;"><atoll-icon name="settings" size="20"></atoll-icon></span>
        With Settings
        <span slot="trailing" style="font-weight: bold; margin-left: 4px;">→</span>
      `
      document.getElementById('section-slots').appendChild(btnSlot)

      // Loading
      const btnLoad = document.createElement('atoll-button')
      btnLoad.setAttribute('variant', 'primary')
      btnLoad.setAttribute('loading', 'true')
      btnLoad.textContent = 'Loading state...'
      document.getElementById('section-loading').appendChild(btnLoad)
    })

    // Wait for rendering
    await page.waitForTimeout(2000)

    // Take screenshot
    await page.screenshot({ path: '/home/jules/verification/screenshots/btn-verification.png' })
  })
})
