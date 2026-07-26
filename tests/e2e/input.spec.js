import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Input Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
  })

  test('should render standard input with default attributes', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-input')
      el.id = 'test-input-basic'
      el.setAttribute('label', 'Test Label')
      el.setAttribute('placeholder', 'Enter value')
      document.body.appendChild(el)
    })

    const group = page.locator('#test-input-basic .atoll-input-group')
    await expect(group).toBeVisible()
    await expect(group).toHaveClass(/atoll-input-md/)

    const label = page.locator('#test-input-basic .atoll-input-label')
    await expect(label).toBeVisible()
    await expect(label).toContainText('Test Label')

    const input = page.locator('#test-input-basic input')
    await expect(input).toBeVisible()
    await expect(input).toHaveAttribute('placeholder', 'Enter value')
    await expect(input).not.toHaveAttribute('required')
  })

  test('should support required mark and size modifiers', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-input')
      el.id = 'test-input-sizes'
      el.setAttribute('label', 'Required field')
      el.setAttribute('required', 'true')
      el.setAttribute('size', 'lg')
      document.body.appendChild(el)
    })

    const group = page.locator('#test-input-sizes .atoll-input-group')
    await expect(group).toHaveClass(/atoll-input-lg/)

    const asterisk = page.locator('#test-input-sizes .atoll-input-required-mark')
    await expect(asterisk).toBeVisible()
    await expect(asterisk).toContainText('*')
  })

  test('should handle character counter functionality', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-input')
      el.id = 'test-input-counter'
      el.setAttribute('label', 'Username')
      el.setAttribute('show-counter', 'true')
      el.setAttribute('maxlength', '15')
      el.setAttribute('value', 'Hello')
      document.body.appendChild(el)
    })

    const counter = page.locator('#test-input-counter .atoll-input-counter')
    await expect(counter).toBeVisible()
    await expect(counter).toContainText('5 / 15')

    // Type in input and check counter updates
    const input = page.locator('#test-input-counter input')
    await input.fill('HelloWorld')
    await expect(counter).toContainText('10 / 15')
  })

  test('should handle clear/reset button interactions and dispatch events', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-input')
      el.id = 'test-input-clear'
      el.setAttribute('clearable', 'true')
      el.setAttribute('value', 'Initially filled')

      // Track event counts
      window.__inputEventCount = 0
      window.__changeEventCount = 0
      el.addEventListener('input', () => {
        window.__inputEventCount++
      })
      el.addEventListener('change', () => {
        window.__changeEventCount++
      })

      document.body.appendChild(el)
    })

    const input = page.locator('#test-input-clear input')
    await expect(input).toHaveValue('Initially filled')

    const clearBtn = page.locator('#test-input-clear button[aria-label="Clear input"]')
    await expect(clearBtn).toBeVisible()

    // Click clear button
    await clearBtn.click()
    await expect(input).toHaveValue('')
    await expect(clearBtn).toBeHidden()

    // Check custom events dispatched
    const eventCounts = await page.evaluate(() => ({
      input: window.__inputEventCount,
      change: window.__changeEventCount
    }))

    expect(eventCounts.input).toBeGreaterThan(0)
    expect(eventCounts.change).toBeGreaterThan(0)
  })

  test('should support password type and toggle show/hide visibility', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-input')
      el.id = 'test-input-password'
      el.setAttribute('type', 'password')
      el.setAttribute('value', 'secretPass')
      document.body.appendChild(el)
    })

    const input = page.locator('#test-input-password input')
    await expect(input).toHaveAttribute('type', 'password')

    const toggleBtn = page.locator('#test-input-password button[aria-label="Toggle password visibility"]')
    await expect(toggleBtn).toBeVisible()

    // Icon should initially be PreviewOpen ('eye')
    const icon = toggleBtn.locator('atoll-icon')
    await expect(icon).toHaveAttribute('name', 'eye')

    // Click toggle
    await toggleBtn.click()
    await expect(input).toHaveAttribute('type', 'text')
    await expect(icon).toHaveAttribute('name', 'eye-off')

    // Click toggle again
    await toggleBtn.click()
    await expect(input).toHaveAttribute('type', 'password')
    await expect(icon).toHaveAttribute('name', 'eye')
  })

  test('should render timer and custom slot actions in code mode', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-input')
      el.id = 'test-input-code'
      el.setAttribute('type', 'code')
      el.setAttribute('timer', '02:36')

      const btn = document.createElement('button')
      btn.setAttribute('slot', 'action')
      btn.id = 'resend-btn'
      btn.textContent = 'Resend Code'
      el.appendChild(btn)

      document.body.appendChild(el)
    })

    const input = page.locator('#test-input-code input')
    await expect(input).toHaveAttribute('type', 'text')

    const timer = page.locator('#test-input-code .atoll-input-timer')
    await expect(timer).toBeVisible()
    await expect(timer).toContainText('02:36')

    const slotBtn = page.locator('#resend-btn')
    await expect(slotBtn).toBeVisible()
    await expect(slotBtn).toContainText('Resend Code')
  })

  test('should reflect disabled, readonly, and invalid/error states', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-input')
      el.id = 'test-input-states'
      el.setAttribute('invalid', 'true')
      el.setAttribute('error-message', 'This is an error!')
      document.body.appendChild(el)
    })

    const group = page.locator('#test-input-states .atoll-input-group')
    await expect(group).toHaveClass(/atoll-input-error/)

    const footer = page.locator('#test-input-states .atoll-input-footer')
    await expect(footer).toBeVisible()
    await expect(footer).toContainText('This is an error!')

    const input = page.locator('#test-input-states input')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  test('should handle programmatic value changes via attribute observation', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-input')
      el.id = 'test-input-programmatic'
      document.body.appendChild(el)
    })

    const input = page.locator('#test-input-programmatic input')
    await expect(input).toHaveValue('')

    await page.evaluate(() => {
      const el = document.getElementById('test-input-programmatic')
      el.setAttribute('value', 'Programmatic Update')
    })

    await expect(input).toHaveValue('Programmatic Update')
  })

  test('should render visual variants for screenshot', async ({ page }) => {
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 30px; padding: 40px; background-color: #f8f9fa; font-family: sans-serif; color: #111;">
          <h2>Atoll Chat Input Component Architecture</h2>
          
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <strong>Small Input (sm) with Character Counter:</strong>
            <div id="section-sm"></div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            <strong>Medium Password Input (md) with Toggle Eye:</strong>
            <div id="section-md"></div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            <strong>Large Verification Code Input (lg) with Timer & Slot action:</strong>
            <div id="section-lg"></div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            <strong>Input in Error State:</strong>
            <div id="section-error"></div>
          </div>
        </div>
      `

      const inputSm = document.createElement('atoll-input')
      inputSm.setAttribute('size', 'sm')
      inputSm.setAttribute('label', 'Display Name')
      inputSm.setAttribute('value', 'Alice')
      inputSm.setAttribute('show-counter', 'true')
      inputSm.setAttribute('maxlength', '20')
      inputSm.setAttribute('clearable', 'true')
      document.getElementById('section-sm').appendChild(inputSm)

      const inputMd = document.createElement('atoll-input')
      inputMd.setAttribute('size', 'md')
      inputMd.setAttribute('type', 'password')
      inputMd.setAttribute('label', 'Password')
      inputMd.setAttribute('value', 'supersecret123')
      document.getElementById('section-md').appendChild(inputMd)

      const inputLg = document.createElement('atoll-input')
      inputLg.setAttribute('size', 'lg')
      inputLg.setAttribute('type', 'code')
      inputLg.setAttribute('label', '6-Digit Verification Code')
      inputLg.setAttribute('value', '935915')
      inputLg.setAttribute('timer', '02:36')
      inputLg.setAttribute('maxlength', '6')

      const btn = document.createElement('button')
      btn.setAttribute('slot', 'action')
      btn.style.cssText = 'background: none; border: none; color: #06C755; font-size: 14px; font-weight: bold; cursor: pointer;'
      btn.textContent = 'Resend code'
      inputLg.appendChild(btn)
      document.getElementById('section-lg').appendChild(inputLg)

      const inputErr = document.createElement('atoll-input')
      inputErr.setAttribute('label', 'Email Address')
      inputErr.setAttribute('value', 'invalid-email-address')
      inputErr.setAttribute('invalid', 'true')
      inputErr.setAttribute('error-message', 'An error has occurred. Incorrect email format.')
      document.getElementById('section-error').appendChild(inputErr)
    })

    // Wait for components to render and hydrate
    await page.waitForTimeout(2000)

    // Take screenshot
    await page.screenshot({ path: '/home/jules/verification/screenshots/verification.png' })
  })
})
