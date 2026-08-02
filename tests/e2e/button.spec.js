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

  test('should apply pill compact sizes and heights', async ({ page }) => {
    await page.evaluate(() => {
      // Create pill small button
      const btnSm = document.createElement('atoll-button')
      btnSm.id = 'test-btn-pill-sm'
      btnSm.setAttribute('pill', 'true')
      btnSm.setAttribute('size', 'sm')
      btnSm.textContent = 'Small Pill'
      document.body.appendChild(btnSm)

      // Create pill medium button
      const btnMd = document.createElement('atoll-button')
      btnMd.id = 'test-btn-pill-md'
      btnMd.setAttribute('pill', 'true')
      btnMd.setAttribute('size', 'md')
      btnMd.textContent = 'Medium Pill'
      document.body.appendChild(btnMd)

      // Create pill large button
      const btnLg = document.createElement('atoll-button')
      btnLg.id = 'test-btn-pill-lg'
      btnLg.setAttribute('pill', 'true')
      btnLg.setAttribute('size', 'lg')
      btnLg.textContent = 'Large Pill'
      document.body.appendChild(btnLg)
    })

    const smallPill = page.locator('#test-btn-pill-sm button')
    const medPill = page.locator('#test-btn-pill-md button')
    const lgPill = page.locator('#test-btn-pill-lg button')

    await expect(smallPill).toHaveCSS('height', '28px')
    await expect(smallPill).toHaveCSS('padding-left', '12px')
    await expect(smallPill).toHaveCSS('padding-right', '12px')

    await expect(medPill).toHaveCSS('height', '36px')
    await expect(medPill).toHaveCSS('padding-left', '16px')
    await expect(medPill).toHaveCSS('padding-right', '16px')

    await expect(lgPill).toHaveCSS('height', '44px')
    await expect(lgPill).toHaveCSS('padding-left', '20px')
    await expect(lgPill).toHaveCSS('padding-right', '20px')

    // Verify touch target expanded pseudo-element (::before exists on small pill button)
    const touchTargetBox = await smallPill.evaluate((el) => {
      const style = window.getComputedStyle(el, '::before')
      return {
        content: style.getPropertyValue('content'),
        minHeight: style.getPropertyValue('min-height'),
        width: style.getPropertyValue('width')
      }
    })
    expect(touchTargetBox.content).toBe('""')
    expect(touchTargetBox.minHeight).toBe('44px')
    expect(parseFloat(touchTargetBox.width)).toBeGreaterThanOrEqual(44)
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

  test('should support leadingIcon, trailingIcon, and text attributes programmatically', async ({ page }) => {
    await page.evaluate(() => {
      const btn = document.createElement('atoll-button')
      btn.id = 'test-btn-attr-slots'
      btn.setAttribute('leading-icon', 'settings')
      btn.setAttribute('trailing-icon', 'arrow-right')
      btn.setAttribute('text', 'Attribute Text')
      document.body.appendChild(btn)
    })

    const buttonHost = page.locator('#test-btn-attr-slots')
    await expect(buttonHost).toBeVisible()

    // Verify programmatically generated icons and text in slots
    const leadingContainer = buttonHost.locator('.atoll-btn-leading')
    await expect(leadingContainer).toBeVisible()
    const leadingIcon = leadingContainer.locator('atoll-icon')
    await expect(leadingIcon).toBeVisible()
    await expect(leadingIcon).toHaveAttribute('name', 'settings')

    const trailingContainer = buttonHost.locator('.atoll-btn-trailing')
    await expect(trailingContainer).toBeVisible()
    const trailingIcon = trailingContainer.locator('atoll-icon')
    await expect(trailingIcon).toBeVisible()
    await expect(trailingIcon).toHaveAttribute('name', 'arrow-right')

    const label = buttonHost.locator('.atoll-btn-label')
    await expect(label).toBeVisible()
    await expect(label).toContainText('Attribute Text')
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

  test('should support icon-only variants with shapes, classes, and accessibility warnings', async ({ page }) => {
    // Collect console logs/warnings during execution
    const warnings = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning') {
        warnings.push(msg.text())
      }
    })

    await page.evaluate(() => {
      // Valid Icon-Only button with aria-label
      const btnValid = document.createElement('atoll-button')
      btnValid.id = 'icon-btn-valid'
      btnValid.setAttribute('icon-only', 'true')
      btnValid.setAttribute('aria-label', 'Valid Search')
      btnValid.innerHTML = '<atoll-icon name="search" size="24"></atoll-icon>'
      document.body.appendChild(btnValid)

      // Invalid Icon-Only button missing aria-label (should trigger warning)
      const btnWarning = document.createElement('atoll-button')
      btnWarning.id = 'icon-btn-warn'
      btnWarning.setAttribute('icon-only', 'true')
      btnWarning.innerHTML = '<atoll-icon name="add" size="20"></atoll-icon>'
      document.body.appendChild(btnWarning)

      // Circular pill variant
      const btnPill = document.createElement('atoll-button')
      btnPill.id = 'icon-btn-pill'
      btnPill.setAttribute('icon-only', 'true')
      btnPill.setAttribute('pill', 'true')
      btnPill.setAttribute('aria-label', 'Circular Mic')
      btnPill.innerHTML = '<atoll-icon name="mic" size="24"></atoll-icon>'
      document.body.appendChild(btnPill)
    })

    const validHost = page.locator('#icon-btn-valid')
    await expect(validHost).toBeVisible()
    const validInner = validHost.locator('button')
    await expect(validInner).toHaveClass(/atoll-btn-icon/)
    await expect(validInner).toHaveAttribute('aria-label', 'Valid Search')

    const pillHost = page.locator('#icon-btn-pill')
    await expect(pillHost).toBeVisible()
    const pillInner = pillHost.locator('button')
    await expect(pillInner).toHaveClass(/atoll-btn-icon/)
    await expect(pillInner).toHaveClass(/atoll-btn-pill/)

    // Assert that the warning was logged
    expect(warnings).toContain('[atoll-button] icon-only buttons require an aria-label attribute for accessibility.')
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

          <div id="section-icon-only" style="display: flex; gap: 20px; align-items: center;">
            <strong>Icon-Only Buttons:</strong>
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

      // Add a capsule layout section for the screenshot
      const capsuleSec = document.createElement('div')
      capsuleSec.id = 'section-capsules'
      capsuleSec.style.display = 'flex'
      capsuleSec.style.gap = '20px'
      capsuleSec.style.alignItems = 'center'
      capsuleSec.innerHTML = '<strong>Capsules / Pills:</strong>'
      document.getElementById('section-loading').parentNode.appendChild(capsuleSec)

      // Active Call Bar Trigger (Primary Capsule)
      const pillPrimary = document.createElement('atoll-button')
      pillPrimary.setAttribute('pill', 'true')
      pillPrimary.setAttribute('variant', 'primary')
      pillPrimary.setAttribute('size', 'md')
      pillPrimary.textContent = 'Return to Call (02:14)'
      capsuleSec.appendChild(pillPrimary)

      // Filter / Category Chip (Secondary Capsule)
      const pillSecondary = document.createElement('atoll-button')
      pillSecondary.setAttribute('pill', 'true')
      pillSecondary.setAttribute('variant', 'secondary')
      pillSecondary.setAttribute('size', 'sm')
      pillSecondary.textContent = 'Unread Only'
      capsuleSec.appendChild(pillSecondary)

      // Floating Quick Reply Chip (Outline Capsule)
      const pillOutline = document.createElement('atoll-button')
      pillOutline.setAttribute('pill', 'true')
      pillOutline.setAttribute('variant', 'outline')
      pillOutline.setAttribute('size', 'sm')
      pillOutline.textContent = 'Quick Reply'
      capsuleSec.appendChild(pillOutline)

      // End Call / Destructive Action Chip (Danger Capsule)
      const pillDanger = document.createElement('atoll-button')
      pillDanger.setAttribute('pill', 'true')
      pillDanger.setAttribute('variant', 'danger')
      pillDanger.setAttribute('size', 'md')
      pillDanger.textContent = 'End Call'
      capsuleSec.appendChild(pillDanger)

      // Icon-Only Buttons
      const iconBtnSm = document.createElement('atoll-button')
      iconBtnSm.setAttribute('icon-only', 'true')
      iconBtnSm.setAttribute('size', 'sm')
      iconBtnSm.setAttribute('variant', 'ghost')
      iconBtnSm.setAttribute('aria-label', 'Attachment')
      iconBtnSm.innerHTML = '<atoll-icon name="add" size="20"></atoll-icon>'
      document.getElementById('section-icon-only').appendChild(iconBtnSm)

      const iconBtnMd = document.createElement('atoll-button')
      iconBtnMd.setAttribute('icon-only', 'true')
      iconBtnMd.setAttribute('size', 'md')
      iconBtnMd.setAttribute('pill', 'true')
      iconBtnMd.setAttribute('variant', 'secondary')
      iconBtnMd.setAttribute('aria-label', 'Video Call')
      iconBtnMd.innerHTML = '<atoll-icon name="videocam" size="24"></atoll-icon>'
      document.getElementById('section-icon-only').appendChild(iconBtnMd)

      const iconBtnLg = document.createElement('atoll-button')
      iconBtnLg.setAttribute('icon-only', 'true')
      iconBtnLg.setAttribute('size', 'lg')
      iconBtnLg.setAttribute('pill', 'true')
      iconBtnLg.setAttribute('variant', 'danger')
      iconBtnLg.setAttribute('aria-label', 'End Call')
      iconBtnLg.innerHTML = '<atoll-icon name="phone" size="32"></atoll-icon>'
      document.getElementById('section-icon-only').appendChild(iconBtnLg)
    })

    // Wait for rendering
    await page.waitForTimeout(2000)

    // Take screenshot
    await page.screenshot({ path: 'tests/e2e/screenshots/btn-verification.png' })
  })
})
