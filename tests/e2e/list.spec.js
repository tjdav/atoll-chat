import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll List and List Item Component Architecture ( State-Driven Architecture)', () => {
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

  test('should broadcast parent mode to child items and support selectAll API', async ({ page }) => {
    await page.evaluate(async () => {
      const listEl = document.createElement('atoll-list')
      listEl.id = 'mode-list'

      const item1 = document.createElement('atoll-list-item')
      item1.id = 'item-1'
      item1.setAttribute('title', 'Item 1')

      const item2 = document.createElement('atoll-list-item')
      item2.id = 'item-2'
      item2.setAttribute('title', 'Item 2')

      listEl.appendChild(item1)
      listEl.appendChild(item2)
      document.body.appendChild(listEl)

      await customElements.whenDefined('atoll-list')
      await customElements.whenDefined('atoll-list-item')
    })

    const list = page.locator('#mode-list')
    const item1 = page.locator('#item-1 .atoll-list-item')
    const item2 = page.locator('#item-2 .atoll-list-item')

    // Switch mode to selection via parent list
    await page.evaluate(() => {
      const listEl = document.querySelector('#mode-list')
      listEl.setAttribute('mode', 'selection')
    })

    await expect(list.locator('.atoll-list')).toHaveClass(/atoll-list-mode-selection/)
    await expect(item1).toHaveClass(/atoll-list-item-mode-selection/)
    await expect(item2).toHaveClass(/atoll-list-item-mode-selection/)

    // Programmatic selectAll API
    await page.evaluate(() => {
      const listEl = document.querySelector('#mode-list')
      listEl.selectAll()
    })

    await expect(page.locator('#item-1')).toHaveAttribute('checked', 'true')
    await expect(page.locator('#item-2')).toHaveAttribute('checked', 'true')

    // Programmatic clearSelection API
    await page.evaluate(() => {
      const listEl = document.querySelector('#mode-list')
      listEl.clearSelection()
    })

    await expect(page.locator('#item-1')).not.toHaveAttribute('checked', 'true')
    await expect(page.locator('#item-2')).not.toHaveAttribute('checked', 'true')
  })

  test('should handle selection mode row tap toggle and event dispatch', async ({ page }) => {
    await page.evaluate(async () => {
      const listEl = document.createElement('atoll-list')
      listEl.id = 'selection-tap-list'
      listEl.setAttribute('mode', 'selection')

      const item = document.createElement('atoll-list-item')
      item.id = 'selection-item'
      item.setAttribute('title', 'Selectable Item')

      window.selectionToggles = []
      item.addEventListener('atoll-item-selection-toggle', (e) => {
        window.selectionToggles.push(e.detail)
      })

      listEl.appendChild(item)
      document.body.appendChild(listEl)

      await customElements.whenDefined('atoll-list')
      await customElements.whenDefined('atoll-list-item')
    })

    const itemLoc = page.locator('#selection-item .atoll-list-item')
    await itemLoc.click()

    let toggles = await page.evaluate(() => window.selectionToggles)
    expect(toggles.length).toBe(1)
    expect(toggles[0].checked).toBe(true)

    await itemLoc.click()
    toggles = await page.evaluate(() => window.selectionToggles)
    expect(toggles.length).toBe(2)
    expect(toggles[0].checked).toBe(true)
  })

  test('should render visual matrix of  states for screenshot', async ({ page }) => {
    await page.evaluate(async () => {
      document.createElement('atoll-list')
      document.createElement('atoll-list-item')

      await customElements.whenDefined('atoll-list')
      await customElements.whenDefined('atoll-list-item')

      document.body.innerHTML = `
        <div id="matrix-container" style="display: flex; flex-direction: column; gap: 24px; padding: 40px; background-color: #f8f9fa; font-family: sans-serif; color: #111; max-width: 600px; margin: 0 auto;">
          <h2>Atoll  State-Driven List Matrix</h2>
          
          <div>
            <h4 style="margin-bottom: 8px;">1. Default Navigation Mode</h4>
            <atoll-list divided="true" id="default-list">
              <atoll-list-item title="Alice" description="Hey, where are we meeting?" timestamp="10:30 AM" badge="1" clickable="true" id="v-alice"></atoll-list-item>
              <atoll-list-item title="Bob" description="Sent a photo." timestamp="Yesterday" clickable="true" id="v-bob"></atoll-list-item>
              <atoll-list-item title="Charlie" description="Away on vacation" disabled="true" clickable="true" id="v-charlie"></atoll-list-item>
            </atoll-list>
          </div>

          <div>
            <h4 style="margin-bottom: 8px;">2. Selection Mode (Contextual Checkboxes)</h4>
            <atoll-list mode="selection" id="selection-list">
              <atoll-list-item title="Alice Smith" description="Selected contact" checked="true" id="v-sel-1"></atoll-list-item>
              <atoll-list-item title="Bob Jones" description="Unselected contact" id="v-sel-2"></atoll-list-item>
            </atoll-list>
          </div>

          <div>
            <h4 style="margin-bottom: 8px;">3. Edit / Delete Mode (Contextual Red Minus Action)</h4>
            <atoll-list mode="edit" divided="true" id="edit-list">
              <atoll-list-item title="Blocked Contact 1" description="Blocked on 10/12" id="v-edit-1"></atoll-list-item>
              <atoll-list-item title="Blocked Contact 2" description="Blocked on 08/15" id="v-edit-2"></atoll-list-item>
            </atoll-list>
          </div>

          <div>
            <h4 style="margin-bottom: 8px;">4. Reorder Mode (Dynamic Right Drag Handles)</h4>
            <atoll-list mode="reorder" id="reorder-list">
              <atoll-list-item title="Pinned Room 1" description="High priority thread" id="v-reorder-1"></atoll-list-item>
              <atoll-list-item title="Pinned Room 2" description="Secondary thread" id="v-reorder-2"></atoll-list-item>
            </atoll-list>
          </div>

          <div>
            <h4 style="margin-bottom: 8px;">5. Highlighted & Selected States</h4>
            <atoll-list id="states-list">
              <atoll-list-item title="Selected Contact" description="Active selection state" selected="true" clickable="true" id="v-selected"></atoll-list-item>
              <atoll-list-item title="Highlighted Item" description="Soft subtle highlight tint" highlighted="true" clickable="true" id="v-highlighted"></atoll-list-item>
            </atoll-list>
          </div>
        </div>
      `
    })

    // Ensure viewport height fits the full matrix without clipping
    await page.setViewportSize({
      width: 1280,
      height: 1400
    })
    await page.waitForTimeout(1000)

    // Capture visual screenshot of the full container element
    await page.locator('#matrix-container').screenshot({ path: 'tests/e2e/screenshots/list_matrix.png' })
  })
})
