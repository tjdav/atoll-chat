import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-tooltip Component Tests', () => {
  test('should support placement quadrants and open states', async ({ page, mountComponent }) => {
    await mountComponent('atoll-tooltip', { text: 'Top Tooltip', placement: 'top', open: 'true' }, '<button>Trigger</button>')
    const tooltipHost = page.locator('#test-component-root')
    const bubble = tooltipHost.locator('.atoll-tooltip-bubble')

    await expect(tooltipHost).toBeVisible()
    await expect(bubble).toBeVisible()
    await expect(bubble).toHaveCSS('opacity', '1')

    // Test bottom placement
    await page.evaluate(() => {
      const el = document.getElementById('test-component-root')
      el.setAttribute('placement', 'bottom')
    })
    await expect(tooltipHost).toHaveAttribute('placement', 'bottom')

    // Test left placement
    await page.evaluate(() => {
      const el = document.getElementById('test-component-root')
      el.setAttribute('placement', 'left')
    })
    await expect(tooltipHost).toHaveAttribute('placement', 'left')

    // Test right placement
    await page.evaluate(() => {
      const el = document.getElementById('test-component-root')
      el.setAttribute('placement', 'right')
    })
    await expect(tooltipHost).toHaveAttribute('placement', 'right')
  })

  test('should assert proper ARIA roles and describedby linkages', async ({ page, mountComponent }) => {
    await mountComponent('atoll-tooltip', { text: 'Plain Tooltip', variant: 'plain' }, '<button>Anchor Plain</button>')
    const plainHost = page.locator('#test-component-root')
    const plainBubble = plainHost.locator('.atoll-tooltip-bubble')
    const plainTrigger = plainHost.locator('[ref$="__trigger"]')

    await expect(plainBubble).toHaveAttribute('role', 'tooltip')
    const plainBubbleId = await plainBubble.getAttribute('id')
    expect(plainBubbleId).not.toBeNull()
    await expect(plainTrigger).toHaveAttribute('aria-describedby', plainBubbleId)
    await expect(plainBubble).toHaveAttribute('aria-hidden', 'true')
  })

  test('should handle hover and focus triggers', async ({ page, mountComponent }) => {
    await mountComponent('atoll-tooltip', { text: 'Hover Text', trigger: 'hover' }, '<button id="anchor-btn">Hover me</button>')
    const tooltipHost = page.locator('#test-component-root')
    const trigger = tooltipHost.locator('#anchor-btn')
    const bubble = tooltipHost.locator('.atoll-tooltip-bubble')

    // Initially hidden
    await expect(bubble).toHaveCSS('opacity', '0')

    // Hover trigger
    await trigger.hover()
    await expect(bubble).toHaveCSS('opacity', '1')

    // Mouse leave
    await page.mouse.move(0, 0)
    await expect(bubble).toHaveCSS('opacity', '0')

    // Focus trigger
    await trigger.focus()
    await expect(bubble).toHaveCSS('opacity', '1')

    // Focus out
    await trigger.blur()
    await expect(bubble).toHaveCSS('opacity', '0')
  })

  test('should handle click trigger and outside dismissal', async ({ page, mountComponent }) => {
    await mountComponent('atoll-tooltip', { text: 'Click Text', trigger: 'click' }, '<button id="click-btn">Click me</button>')
    const tooltipHost = page.locator('#test-component-root')
    const trigger = tooltipHost.locator('#click-btn')
    const bubble = tooltipHost.locator('.atoll-tooltip-bubble')

    await expect(bubble).toHaveCSS('opacity', '0')

    // Click to open
    await trigger.click()
    await expect(bubble).toHaveCSS('opacity', '1')

    // Click outside to dismiss
    await page.mouse.click(0, 0)
    await expect(bubble).toHaveCSS('opacity', '0')
  })

  test('should support keyboard navigation via Escape key', async ({ page, mountComponent }) => {
    await mountComponent('atoll-tooltip', { text: 'Esc Text', trigger: 'click' }, '<button id="esc-btn">Click for Esc</button>')
    const tooltipHost = page.locator('#test-component-root')
    const trigger = tooltipHost.locator('#esc-btn')
    const bubble = tooltipHost.locator('.atoll-tooltip-bubble')

    await trigger.click()
    await expect(bubble).toHaveCSS('opacity', '1')

    await page.keyboard.press('Escape')
    await expect(bubble).toHaveCSS('opacity', '0')
  })

  test('should support manual trigger mode and public show/hide API', async ({ page, mountComponent }) => {
    await mountComponent('atoll-tooltip', { text: 'Manual Text', trigger: 'manual' }, '<button id="manual-btn">Manual Anchor</button>')
    const tooltipHost = page.locator('#test-component-root')
    const bubble = tooltipHost.locator('.atoll-tooltip-bubble')

    await expect(bubble).toHaveCSS('opacity', '0')

    // Imperative show()
    await page.evaluate(() => {
      const el = document.getElementById('test-component-root')
      el.show()
    })
    await expect(bubble).toHaveCSS('opacity', '1')

    // Imperative hide()
    await page.evaluate(() => {
      const el = document.getElementById('test-component-root')
      el.hide()
    })
    await expect(bubble).toHaveCSS('opacity', '0')
  })

  test('should support action balloon variant with title, close button, and custom event emission', async ({ page, mountComponent }) => {
    await mountComponent('atoll-tooltip', {
      variant: 'action',
      title: 'Action Balloon',
      closeable: 'true',
      open: 'true',
      text: 'Action balloon body content'
    }, '<button>Action Target</button>')

    await page.evaluate(() => {
      window.__tooltipClosedDispatched = false
      const el = document.getElementById('test-component-root')
      el.addEventListener('atoll-tooltip-close', () => {
        window.__tooltipClosedDispatched = true
      })
    })

    const tooltipHost = page.locator('#test-component-root')
    const bubble = tooltipHost.locator('.atoll-tooltip-bubble')
    const closeBtn = tooltipHost.locator('.atoll-tooltip-header atoll-button')

    await expect(bubble).toBeVisible()
    await expect(bubble).toHaveAttribute('role', 'dialog')
    await expect(tooltipHost.locator('.atoll-tooltip-header')).toContainText('Action Balloon')
    await expect(closeBtn).toBeVisible()

    // Close button click
    await closeBtn.click()
    await expect(bubble).toHaveCSS('opacity', '0')

    const eventDispatched = await page.evaluate(() => window.__tooltipClosedDispatched)
    expect(eventDispatched).toBe(true)
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
      matrix.style.cssText = 'display: flex; flex-direction: column; gap: 48px; padding: 48px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111); font-family: system-ui, sans-serif;'

      const title = document.createElement('h2')
      title.style.cssText = 'margin: 0; font-size: 20px;'
      title.textContent = 'atoll-tooltip Visual Verification Matrix'
      matrix.appendChild(title)

      // Section 1: Placement Quadrants
      const sec1 = document.createElement('div')
      const sec1Title = document.createElement('div')
      sec1Title.style.cssText = 'font-weight: 600; margin-bottom: 24px;'
      sec1Title.textContent = 'Placement Quadrants (Plain)'
      sec1.appendChild(sec1Title)

      const quadrantsRow = document.createElement('div')
      quadrantsRow.style.cssText = 'display: flex; gap: 80px; align-items: center; justify-content: space-around; padding: 48px 80px;'

      ;[
        { id: 'vis-top', placement: 'top', text: 'Top Tooltip', btnText: 'Top' },
        { id: 'vis-bottom', placement: 'bottom', text: 'Bottom Tooltip', btnText: 'Bottom' },
        { id: 'vis-left', placement: 'left', text: 'Left Tooltip', btnText: 'Left' },
        { id: 'vis-right', placement: 'right', text: 'Right Tooltip', btnText: 'Right' }
      ].forEach(item => {
        const tt = document.createElement('atoll-tooltip')
        tt.id = item.id
        tt.setAttribute('placement', item.placement)
        tt.setAttribute('open', 'true')
        tt.setAttribute('trigger', 'manual')
        tt.setAttribute('text', item.text)

        const btn = document.createElement('atoll-button')
        btn.setAttribute('size', 'sm')
        btn.textContent = item.btnText
        tt.appendChild(btn)

        quadrantsRow.appendChild(tt)
      })
      sec1.appendChild(quadrantsRow)
      matrix.appendChild(sec1)

      // Section 2: Action Balloon Variant
      const sec2 = document.createElement('div')
      const sec2Title = document.createElement('div')
      sec2Title.style.cssText = 'font-weight: 600; margin-bottom: 24px;'
      sec2Title.textContent = 'Action Balloon Variant'
      sec2.appendChild(sec2Title)

      const actionRow = document.createElement('div')
      actionRow.style.cssText = 'display: flex; gap: 32px; align-items: center; padding: 60px 80px 48px 80px;'

      const actTt = document.createElement('atoll-tooltip')
      actTt.id = 'vis-action'
      actTt.setAttribute('variant', 'action')
      actTt.setAttribute('title', 'Feature Info')
      actTt.setAttribute('closeable', 'true')
      actTt.setAttribute('open', 'true')
      actTt.setAttribute('trigger', 'manual')
      actTt.setAttribute('text', 'Action balloon with header and close trigger.')

      const actBtn = document.createElement('atoll-button')
      actBtn.setAttribute('variant', 'secondary')
      actBtn.textContent = 'Action Anchor'
      actTt.appendChild(actBtn)

      actionRow.appendChild(actTt)
      sec2.appendChild(actionRow)
      matrix.appendChild(sec2)

      mountPoint.appendChild(matrix)
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('tooltip-verification-light', matrix)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('tooltip-verification-dark', matrix)
  })
})
