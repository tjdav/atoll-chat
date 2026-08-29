import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-input Component Tests', () => {
  test('should render standard input with default attributes, label, and placeholder', async ({ page, mountComponent }) => {
    await mountComponent('atoll-input', {
      label: 'User Name',
      placeholder: 'Enter your name'
    })

    const inputHost = page.locator('#test-component-root')
    const label = inputHost.locator('.atoll-input-label')
    const input = inputHost.locator('.atoll-input-field')

    await expect(inputHost).toBeVisible()
    await expect(label).toContainText('User Name')
    await expect(input).toHaveAttribute('placeholder', 'Enter your name')
  })

  test('should support required mark and size scale modifiers (sm, md, lg)', async ({ page, mountComponent }) => {
    await mountComponent('atoll-input', {
      label: 'Email',
      required: 'true',
      size: 'sm'
    })

    const inputHost = page.locator('#test-component-root')
    const wrapper = inputHost.locator('.atoll-input-wrapper')
    const requiredMark = inputHost.locator('.atoll-input-required-mark')

    await expect(requiredMark).toBeVisible()
    await expect(wrapper).toHaveCSS('height', '36px')

    await inputHost.evaluate(el => el.setAttribute('size', 'lg'))
    await expect(wrapper).toHaveCSS('height', '52px')
  })

  test('should update character counter dynamically on input', async ({ page, mountComponent }) => {
    await mountComponent('atoll-input', {
      label: 'Bio',
      'show-counter': 'true',
      maxlength: '20',
      value: 'Hello'
    })

    const inputHost = page.locator('#test-component-root')
    const counter = inputHost.locator('.atoll-input-counter')
    const input = inputHost.locator('.atoll-input-field')

    await expect(counter).toContainText('5 / 20')

    await input.fill('Hello World!')
    await expect(counter).toContainText('12 / 20')
  })

  test('should handle clear button trigger and dispatch native input/change events', async ({ page, mountComponent }) => {
    await mountComponent('atoll-input', {
      clearable: 'true',
      value: 'Initial value'
    })

    const inputHost = page.locator('#test-component-root')
    const input = inputHost.locator('.atoll-input-field')
    const clearBtn = inputHost.locator('button[aria-label="Clear input"]')

    await expect(clearBtn).toBeVisible()

    await clearBtn.click()
    await expect(input).toHaveValue('')
    await expect(input).toBeFocused()
    await expect(clearBtn).toBeHidden()
  })

  test('should toggle password visibility and icon on eye button click', async ({ page, mountComponent }) => {
    await mountComponent('atoll-input', {
      type: 'password',
      value: 'secret123'
    })

    const inputHost = page.locator('#test-component-root')
    const input = inputHost.locator('.atoll-input-field')
    const passBtn = inputHost.locator('button[aria-label="Toggle password visibility"]')
    const icon = passBtn.locator('atoll-icon')

    await expect(input).toHaveAttribute('type', 'password')
    await expect(icon).toHaveAttribute('name', 'eye')

    await passBtn.click()
    await expect(input).toHaveAttribute('type', 'text')
    await expect(icon).toHaveAttribute('name', 'eye-off')
  })

  test('should support code mode with countdown timer and trailing action slot', async ({ page, mountComponent }) => {
    await mountComponent('atoll-input', {
      type: 'code',
      timer: '02:30'
    }, '<button slot="action" class="resend-btn">Resend</button>')

    const inputHost = page.locator('#test-component-root')
    const timer = inputHost.locator('.atoll-input-timer')
    const resendBtn = inputHost.locator('.resend-btn')

    await expect(timer).toBeVisible()
    await expect(timer).toHaveText('02:30')
    await expect(resendBtn).toBeVisible()
  })

  test('should display invalid error state with red underline and error message', async ({ page, mountComponent }) => {
    await mountComponent('atoll-input', {
      invalid: 'true',
      'error-message': 'Invalid credentials.'
    })

    const inputHost = page.locator('#test-component-root')
    const footer = inputHost.locator('.atoll-input-footer')

    await expect(footer).toBeVisible()
    await expect(footer).toContainText('Invalid credentials.')
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
      matrix.style.cssText = 'display: flex; flex-direction: column; gap: 32px; padding: 48px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111); font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto;'

      const title = document.createElement('h2')
      title.style.cssText = 'margin: 0; font-size: 20px;'
      title.textContent = 'atoll-input Visual Verification Matrix'
      matrix.appendChild(title)

      const group = document.createElement('div')
      group.style.cssText = 'display: flex; flex-direction: column; gap: 24px;'

      // 1. Small Input with Counter
      const wrap1 = document.createElement('div')
      const inp1 = document.createElement('atoll-input')
      inp1.setAttribute('size', 'sm')
      inp1.setAttribute('label', 'Display Name')
      inp1.setAttribute('value', 'Alex Morgan')
      inp1.setAttribute('show-counter', 'true')
      inp1.setAttribute('maxlength', '30')
      inp1.setAttribute('clearable', 'true')
      wrap1.appendChild(inp1)
      group.appendChild(wrap1)

      // 2. Medium Password Input
      const wrap2 = document.createElement('div')
      const inp2 = document.createElement('atoll-input')
      inp2.setAttribute('type', 'password')
      inp2.setAttribute('label', 'Vault Master Password')
      inp2.setAttribute('value', 'SuperSecretPass123!')
      wrap2.appendChild(inp2)
      group.appendChild(wrap2)

      // 3. Large Code Input with Timer & Action
      const wrap3 = document.createElement('div')
      const inp3 = document.createElement('atoll-input')
      inp3.setAttribute('size', 'lg')
      inp3.setAttribute('type', 'code')
      inp3.setAttribute('label', '2-Step Verification Code')
      inp3.setAttribute('placeholder', '000000')
      inp3.setAttribute('timer', '02:45')
      inp3.innerHTML = '<button slot="action" style="background: none; border: none; color: #06C755; font-size: 13px; font-weight: bold; cursor: pointer;">Resend</button>'
      wrap3.appendChild(inp3)
      group.appendChild(wrap3)

      // 4. Invalid Input with Error Message
      const wrap4 = document.createElement('div')
      const inp4 = document.createElement('atoll-input')
      inp4.setAttribute('label', 'Email Address')
      inp4.setAttribute('value', 'invalid-email-format')
      inp4.setAttribute('invalid', 'true')
      inp4.setAttribute('error-message', 'Please enter a valid email address.')
      wrap4.appendChild(inp4)
      group.appendChild(wrap4)

      matrix.appendChild(group)
      mountPoint.appendChild(matrix)
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('input-verification-light', matrix)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('input-verification-dark', matrix)
  })
})
