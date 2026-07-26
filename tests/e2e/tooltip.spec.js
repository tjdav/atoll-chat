import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Tooltip Component', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log(`BROWSER CONSOLE ${msg.type().toUpperCase()}:`, msg.text())
      }
    })
    page.on('pageerror', err => {
      console.log('BROWSER PAGE ERROR:', err.message, err.stack)
    })

    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
  })

  test('should support placement quadrants and proper CSS classes', async ({ page }) => {
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'tooltip-container'

      const placements = ['top', 'bottom', 'left', 'right']
      placements.forEach(p => {
        const el = document.createElement('atoll-tooltip')
        el.id = `tooltip-${p}`
        el.setAttribute('text', `${p} Tooltip`)
        el.setAttribute('placement', p)

        const btn = document.createElement('button')
        btn.id = `trigger-${p}`
        btn.textContent = p

        el.appendChild(btn)
        container.appendChild(el)
      })

      document.body.appendChild(container)
    })

    const topTooltip = page.locator('#tooltip-top')
    const bottomTooltip = page.locator('#tooltip-bottom')
    const leftTooltip = page.locator('#tooltip-left')
    const rightTooltip = page.locator('#tooltip-right')

    await expect(topTooltip).toBeVisible()

    const bubbleTop = topTooltip.locator('.atoll-tooltip-bubble')
    const bubbleBottom = bottomTooltip.locator('.atoll-tooltip-bubble')
    const bubbleLeft = leftTooltip.locator('.atoll-tooltip-bubble')
    const bubbleRight = rightTooltip.locator('.atoll-tooltip-bubble')

    await expect(bubbleTop).toHaveClass(/atoll-tooltip-top/)
    await expect(bubbleBottom).toHaveClass(/atoll-tooltip-bottom/)
    await expect(bubbleLeft).toHaveClass(/atoll-tooltip-left/)
    await expect(bubbleRight).toHaveClass(/atoll-tooltip-right/)
  })

  test('should handle hover and focus triggers', async ({ page }) => {
    await page.evaluate(() => {
      const tooltip = document.createElement('atoll-tooltip')
      tooltip.id = 'test-hover'
      tooltip.setAttribute('text', 'Hover Text')
      tooltip.setAttribute('trigger', 'hover')
      tooltip.innerHTML = '<button id="anchor-hover">Hover me</button>'
      document.body.appendChild(tooltip)
    })

    const tooltip = page.locator('#test-hover')
    const trigger = page.locator('#anchor-hover')
    const bubble = tooltip.locator('.atoll-tooltip-bubble')

    // Initially hidden
    await expect(bubble).not.toHaveClass(/atoll-tooltip-visible/)

    // Hover trigger
    await trigger.hover()
    await expect(bubble).toHaveClass(/atoll-tooltip-visible/)

    // Mouse leave
    await page.mouse.move(0, 0)
    await expect(bubble).not.toHaveClass(/atoll-tooltip-visible/)

    // Focus trigger
    await trigger.focus()
    await expect(bubble).toHaveClass(/atoll-tooltip-visible/)

    // Focus out
    await trigger.blur()
    await expect(bubble).not.toHaveClass(/atoll-tooltip-visible/)
  })

  test('should handle click and outside dismissal', async ({ page }) => {
    await page.evaluate(() => {
      const tooltip = document.createElement('atoll-tooltip')
      tooltip.id = 'test-click'
      tooltip.setAttribute('text', 'Click Text')
      tooltip.setAttribute('trigger', 'click')
      tooltip.innerHTML = '<button id="anchor-click">Click me</button>'

      const outside = document.createElement('button')
      outside.id = 'outside-btn'
      outside.textContent = 'Outside Button'

      document.body.appendChild(tooltip)
      document.body.appendChild(outside)
    })

    const tooltip = page.locator('#test-click')
    const trigger = page.locator('#anchor-click')
    const outside = page.locator('#outside-btn')
    const bubble = tooltip.locator('.atoll-tooltip-bubble')

    // Initially hidden
    await expect(bubble).not.toHaveClass(/atoll-tooltip-visible/)

    // Click to open
    await trigger.click()
    await expect(bubble).toHaveClass(/atoll-tooltip-visible/)

    // Click again to close
    await trigger.click()
    await expect(bubble).not.toHaveClass(/atoll-tooltip-visible/)

    // Click to open again
    await trigger.click()
    await expect(bubble).toHaveClass(/atoll-tooltip-visible/)

    // Click outside to dismiss
    await outside.click()
    await expect(bubble).not.toHaveClass(/atoll-tooltip-visible/)
  })

  test('should support keyboard navigation via Escape key', async ({ page }) => {
    await page.evaluate(() => {
      const tooltip = document.createElement('atoll-tooltip')
      tooltip.id = 'test-esc'
      tooltip.setAttribute('text', 'Esc Text')
      tooltip.setAttribute('trigger', 'click')
      tooltip.innerHTML = '<button id="anchor-esc">Click for Esc</button>'
      document.body.appendChild(tooltip)
    })

    const tooltip = page.locator('#test-esc')
    const trigger = page.locator('#anchor-esc')
    const bubble = tooltip.locator('.atoll-tooltip-bubble')

    // Click to open
    await trigger.click()
    await expect(bubble).toHaveClass(/atoll-tooltip-visible/)

    // Press Escape
    await page.keyboard.press('Escape')
    await expect(bubble).not.toHaveClass(/atoll-tooltip-visible/)
  })

  test('should assert proper ARIA roles and relations', async ({ page }) => {
    await page.evaluate(() => {
      const tooltipPlain = document.createElement('atoll-tooltip')
      tooltipPlain.id = 'test-aria-plain'
      tooltipPlain.setAttribute('text', 'Plain Tooltip')
      tooltipPlain.setAttribute('variant', 'plain')
      tooltipPlain.innerHTML = '<button>Anchor Plain</button>'
      document.body.appendChild(tooltipPlain)

      const tooltipAction = document.createElement('atoll-tooltip')
      tooltipAction.id = 'test-aria-action'
      tooltipAction.setAttribute('text', 'Action Tooltip')
      tooltipAction.setAttribute('variant', 'action')
      tooltipAction.setAttribute('title', 'Action Title')
      tooltipAction.innerHTML = '<button>Anchor Action</button>'
      document.body.appendChild(tooltipAction)
    })

    const plainHost = page.locator('#test-aria-plain')
    const plainBubble = plainHost.locator('.atoll-tooltip-bubble')
    const plainTrigger = plainHost.locator('[ref$="__trigger"]')

    const actionHost = page.locator('#test-aria-action')
    const actionBubble = actionHost.locator('.atoll-tooltip-bubble')
    const actionTrigger = actionHost.locator('[ref$="__trigger"]')

    // Roles
    await expect(plainBubble).toHaveAttribute('role', 'tooltip')
    await expect(actionBubble).toHaveAttribute('role', 'dialog')

    // Aria-describedby linkages
    const plainId = await plainBubble.getAttribute('id')
    expect(plainId).not.toBeNull()
    await expect(plainTrigger).toHaveAttribute('aria-describedby', plainId)

    const actionId = await actionBubble.getAttribute('id')
    expect(actionId).not.toBeNull()
    await expect(actionTrigger).toHaveAttribute('aria-describedby', actionId)
  })

  test('should support closeable action balloons and close button triggers', async ({ page }) => {
    let closedEventDispatched = false
    await page.exposeFunction('onTooltipClosed', () => {
      closedEventDispatched = true
    })

    await page.evaluate(() => {
      const tooltip = document.createElement('atoll-tooltip')
      tooltip.id = 'test-closeable'
      tooltip.setAttribute('variant', 'action')
      tooltip.setAttribute('title', 'Closeable Bubble')
      tooltip.setAttribute('text', 'Click the X to hide me')
      tooltip.setAttribute('closeable', 'true')
      tooltip.setAttribute('trigger', 'click')
      tooltip.innerHTML = '<button id="anchor-closeable">Trigger Closeable</button>'

      tooltip.addEventListener('atoll-tooltip-close', () => {
        window.onTooltipClosed()
      })

      document.body.appendChild(tooltip)
    })

    const tooltip = page.locator('#test-closeable')
    const trigger = page.locator('#anchor-closeable')
    const bubble = tooltip.locator('.atoll-tooltip-bubble')
    const closeBtn = tooltip.locator('[ref$="__closeBtn"]')

    // Initially hidden
    await expect(bubble).not.toHaveClass(/atoll-tooltip-visible/)

    // Click to open
    await trigger.click()
    await expect(bubble).toHaveClass(/atoll-tooltip-visible/)
    await expect(closeBtn).toBeVisible()

    // Click the close button
    await closeBtn.click()
    await expect(bubble).not.toHaveClass(/atoll-tooltip-visible/)

    // Confirm custom event dispatching
    expect(closedEventDispatched).toBe(true)
  })

  test('should render visual variants for screenshot verification', async ({ page }) => {
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 40px; padding: 40px; background-color: #f8f9fa; font-family: sans-serif; color: #111; height: 100vh; box-sizing: border-box;">
          <h2>Atoll Chat Tooltip Component Architecture</h2>
          
          <div style="display: flex; gap: 80px; align-items: center; margin-top: 40px;">
            <div id="section-plain" style="display: flex; flex-direction: column; gap: 20px;">
              <strong>Plain Hover Tooltips (Various placements):</strong>
              <div id="plain-container" style="display: flex; gap: 60px;">
              </div>
            </div>

            <div id="section-action" style="display: flex; flex-direction: column; gap: 20px;">
              <strong>Action Balloon Popovers:</strong>
              <div id="action-container" style="display: flex; gap: 60px;">
              </div>
            </div>
          </div>
        </div>
      `

      // Plain top
      const pTop = document.createElement('atoll-tooltip')
      pTop.id = 'p-top'
      pTop.setAttribute('text', 'This is a top plain tooltip')
      pTop.setAttribute('placement', 'top')
      pTop.setAttribute('open', 'true')
      pTop.innerHTML = '<button style="padding: 8px 12px; border-radius: 4px; border: 1px solid #ccc; background: white;">Top Anchor</button>'
      document.getElementById('plain-container').appendChild(pTop)

      // Plain bottom
      const pBottom = document.createElement('atoll-tooltip')
      pBottom.id = 'p-bottom'
      pBottom.setAttribute('text', 'This is a bottom plain tooltip')
      pBottom.setAttribute('placement', 'bottom')
      pBottom.setAttribute('open', 'true')
      pBottom.innerHTML = '<button style="padding: 8px 12px; border-radius: 4px; border: 1px solid #ccc; background: white;">Bottom Anchor</button>'
      document.getElementById('plain-container').appendChild(pBottom)

      // Action left
      const aLeft = document.createElement('atoll-tooltip')
      aLeft.id = 'a-left'
      aLeft.setAttribute('variant', 'action')
      aLeft.setAttribute('title', 'Onboarding Guide')
      aLeft.setAttribute('text', 'Left balloon placement example with bordered beak.')
      aLeft.setAttribute('placement', 'left')
      aLeft.setAttribute('closeable', 'true')
      aLeft.setAttribute('open', 'true')
      aLeft.innerHTML = '<button style="padding: 8px 12px; border-radius: 4px; border: 1px solid #ccc; background: white;">Left Anchor</button>'
      document.getElementById('action-container').appendChild(aLeft)

      // Action right
      const aRight = document.createElement('atoll-tooltip')
      aRight.id = 'a-right'
      aRight.setAttribute('variant', 'action')
      aRight.setAttribute('title', 'New Voice Stage')
      aRight.setAttribute('text', 'Start real-time audio rooms directly inside your community.')
      aRight.setAttribute('placement', 'right')
      aRight.setAttribute('closeable', 'true')
      aRight.setAttribute('open', 'true')
      aRight.innerHTML = '<button style="padding: 8px 12px; border-radius: 4px; border: 1px solid #ccc; background: white;">Right Anchor</button>'
      document.getElementById('action-container').appendChild(aRight)
    })

    // Wait for elements to fully render and layout
    await page.waitForTimeout(2000)

    // Ensure they are indeed rendered with visible class
    const bubbleTop = page.locator('#p-top .atoll-tooltip-bubble')
    const bubbleBottom = page.locator('#p-bottom .atoll-tooltip-bubble')
    const bubbleLeft = page.locator('#a-left .atoll-tooltip-bubble')
    const bubbleRight = page.locator('#a-right .atoll-tooltip-bubble')

    await expect(bubbleTop).toHaveClass(/atoll-tooltip-visible/)
    await expect(bubbleBottom).toHaveClass(/atoll-tooltip-visible/)
    await expect(bubbleLeft).toHaveClass(/atoll-tooltip-visible/)
    await expect(bubbleRight).toHaveClass(/atoll-tooltip-visible/)

    // Take screenshot
    await page.screenshot({ path: '/home/jules/verification/screenshots/verification.png' })
  })
})
