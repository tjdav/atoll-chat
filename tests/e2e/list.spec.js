import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll List and List Item Component Architecture', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
  })

  test('should render container with divided options', async ({ page }) => {
    await page.evaluate(async () => {
      const listEl = document.createElement('atoll-list')
      listEl.id = 'test-list-divided'
      listEl.setAttribute('divided', 'true')

      const item1 = document.createElement('atoll-list-item')
      item1.setAttribute('title', 'Item 1')
      const item2 = document.createElement('atoll-list-item')
      item2.setAttribute('title', 'Item 2')

      listEl.appendChild(item1)
      listEl.appendChild(item2)
      document.body.appendChild(listEl)

      // Wait for both to be upgraded
      await customElements.whenDefined('atoll-list')
      await customElements.whenDefined('atoll-list-item')
    })

    const list = page.locator('#test-list-divided')
    await expect(list).toBeVisible()
    await expect(list.locator('.atoll-list')).toHaveClass(/atoll-list-divided/)
  })

  test('should handle size modifier attributes and defaults', async ({ page }) => {
    await page.evaluate(async () => {
      const container = document.createElement('div')
      container.id = 'test-sizes'

      const itemSm = document.createElement('atoll-list-item')
      itemSm.setAttribute('title', 'Small Item')
      itemSm.setAttribute('size', 'sm')
      itemSm.id = 'item-sm'

      const itemMd = document.createElement('atoll-list-item')
      itemMd.setAttribute('title', 'Medium Item')
      itemMd.setAttribute('size', 'md')
      itemMd.id = 'item-md'

      const itemLg = document.createElement('atoll-list-item')
      itemLg.setAttribute('title', 'Large Item')
      itemLg.setAttribute('size', 'lg')
      itemLg.id = 'item-lg'

      container.appendChild(itemSm)
      container.appendChild(itemMd)
      container.appendChild(itemLg)
      document.body.appendChild(container)

      await customElements.whenDefined('atoll-list-item')
    })

    const itemSm = page.locator('#item-sm .atoll-list-item')
    const itemMd = page.locator('#item-md .atoll-list-item')
    const itemLg = page.locator('#item-lg .atoll-list-item')

    await expect(itemSm).toHaveClass(/atoll-list-item-sm/)
    await expect(itemMd).toHaveClass(/atoll-list-item-md/)
    await expect(itemLg).toHaveClass(/atoll-list-item-lg/)
  })

  test('should support slot projections and unnamed default slot', async ({ page }) => {
    await page.evaluate(async () => {
      const item = document.createElement('atoll-list-item')
      item.id = 'test-item-slots'
      item.setAttribute('timestamp', '12:00 PM')
      item.setAttribute('badge', '3')
      item.setAttribute('chevron', 'true')

      // Left Slot
      const leftIcon = document.createElement('div')
      leftIcon.setAttribute('slot', 'left')
      leftIcon.id = 'left-slot-el'
      leftIcon.innerText = 'LEFT'
      item.appendChild(leftIcon)

      // Right Slot
      const rightIcon = document.createElement('div')
      rightIcon.setAttribute('slot', 'right')
      rightIcon.id = 'right-slot-el'
      rightIcon.innerText = 'RIGHT'
      item.appendChild(rightIcon)

      // Default slot custom layout content
      const defaultContent = document.createElement('strong')
      defaultContent.id = 'default-slot-el'
      defaultContent.innerText = 'Custom Title Content'
      item.appendChild(defaultContent)

      document.body.appendChild(item)

      await customElements.whenDefined('atoll-list-item')
    })

    const item = page.locator('#test-item-slots')
    await expect(item.locator('#left-slot-el')).toBeVisible()
    await expect(item.locator('#right-slot-el')).toBeVisible()
    await expect(item.locator('#default-slot-el')).toBeVisible()
    await expect(item.locator('.atoll-list-item-timestamp')).toHaveText('12:00 PM')

    const badge = item.locator('atoll-badge')
    await expect(badge).toBeVisible()
    await expect(badge.locator('.atoll-badge')).toHaveText('3')

    const chevron = item.locator('.atoll-list-item-chevron')
    await expect(chevron).toBeVisible()
  })

  test('should handle clicks, focus, and Enter/Space keyboard trigger interaction', async ({ page }) => {
    await page.evaluate(async () => {
      const item = document.createElement('atoll-list-item')
      item.id = 'clickable-item'
      item.setAttribute('title', 'Interactive Item')
      item.setAttribute('clickable', 'true')

      window.itemClicks = []
      item.addEventListener('atoll-item-click', (e) => {
        window.itemClicks.push(e.detail)
      })

      document.body.appendChild(item)

      await customElements.whenDefined('atoll-list-item')
    })

    const item = page.locator('#clickable-item')
    const rootDiv = item.locator('.atoll-list-item')

    await expect(rootDiv).toHaveAttribute('role', 'button')
    await expect(rootDiv).toHaveAttribute('tabindex', '0')

    // Click trigger
    await rootDiv.click()
    let clicks = await page.evaluate(() => window.itemClicks)
    expect(clicks.length).toBe(1)
    expect(clicks[0].title).toBe('Interactive Item')

    // Keydown trigger: Enter
    await rootDiv.focus()
    await page.keyboard.press('Enter')
    clicks = await page.evaluate(() => window.itemClicks)
    expect(clicks.length).toBe(2)

    // Keydown trigger: Space
    await page.keyboard.press(' ')
    clicks = await page.evaluate(() => window.itemClicks)
    expect(clicks.length).toBe(3)
  })

  test('should respect disabled status and block click and focus interaction', async ({ page }) => {
    await page.evaluate(async () => {
      const item = document.createElement('atoll-list-item')
      item.id = 'disabled-item'
      item.setAttribute('title', 'Disabled Item')
      item.setAttribute('clickable', 'true')
      item.setAttribute('disabled', 'true')

      window.disabledClicks = []
      item.addEventListener('atoll-item-click', (e) => {
        window.disabledClicks.push(e.detail)
      })

      document.body.appendChild(item)

      await customElements.whenDefined('atoll-list-item')
    })

    const item = page.locator('#disabled-item')
    const rootDiv = item.locator('.atoll-list-item')

    await expect(rootDiv).toHaveAttribute('tabindex', '-1')
    await expect(rootDiv).toHaveClass(/disabled/)

    // Attempt Click
    await rootDiv.click({ force: true })
    const clicks = await page.evaluate(() => window.disabledClicks)
    expect(clicks.length).toBe(0)
  })

  test('should render visual matrix of states for screenshot', async ({ page }) => {
    await page.evaluate(async () => {
      // Trigger loading of both components programmatically first so they are upgraded
      document.createElement('atoll-list')
      document.createElement('atoll-list-item')

      await customElements.whenDefined('atoll-list')
      await customElements.whenDefined('atoll-list-item')

      // Setup a clean layout for the visual verification
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 24px; padding: 40px; background-color: #f8f9fa; font-family: sans-serif; color: #111; max-width: 600px; margin: 0 auto;">
          <h2>Atoll List & List Item Component Matrix</h2>
          
          <div>
            <h4 style="margin-bottom: 8px;">1. Standard Multi-item Divided List</h4>
            <atoll-list divided="true" id="standard-list">
              <atoll-list-item title="Alice" description="Hey, where are we meeting?" timestamp="10:30 AM" badge="1" clickable="true" id="v-alice"></atoll-list-item>
              <atoll-list-item title="Bob" description="Sent a photo." timestamp="Yesterday" clickable="true" id="v-bob"></atoll-list-item>
              <atoll-list-item title="Charlie" description="Away on vacation" disabled="true" clickable="true" id="v-charlie"></atoll-list-item>
            </atoll-list>
          </div>

          <div>
            <h4 style="margin-bottom: 8px;">2. Selected State (with Left Accent Indicator)</h4>
            <atoll-list id="selected-list">
              <atoll-list-item title="Selected Contact" description="Active selection state" selected="true" clickable="true" id="v-selected"></atoll-list-item>
            </atoll-list>
          </div>

          <div>
            <h4 style="margin-bottom: 8px;">3. Highlighted State</h4>
            <atoll-list id="highlighted-list">
              <atoll-list-item title="Highlighted Item" description="Soft subtle highlight tint" highlighted="true" clickable="true" id="v-highlighted"></atoll-list-item>
            </atoll-list>
          </div>

          <div>
            <h4 style="margin-bottom: 8px;">4. Complex Slotted Layouts</h4>
            <atoll-list divided="true" id="slotted-list">
              <atoll-list-item title="Settings Item" description="Customize theme and sounds" chevron="true" size="lg" id="v-settings">
                <atoll-icon slot="left" name="setting-two" size="24" color="primary"></atoll-icon>
              </atoll-list-item>
            </atoll-list>
          </div>
        </div>
      `
    })

    // Wait for components to fully load and render
    await page.waitForTimeout(2000)

    // Capture visual screenshot
    await page.screenshot({ path: '/home/jules/verification/screenshots/list_matrix.png' })
  })
})
