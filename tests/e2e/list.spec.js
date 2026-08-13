import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll List and List Item Component Architecture', () => {
  test.beforeEach(async ({ page, context }) => {
    // Seed localStorage with mock instance ID to prevent background conflict reloads
    await context.addInitScript(() => {
      window.localStorage.setItem('atoll_active_instance_id', 'mock_test_instance_123')
    })
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => {
      let sandbox = document.getElementById('test-sandbox')

      if (sandbox) {
        sandbox.innerHTML = ''
      } else {
        sandbox = document.createElement('div')
        sandbox.id = 'test-sandbox'
        sandbox.style.position = 'fixed'
        sandbox.style.top = '0'
        sandbox.style.left = '0'
        sandbox.style.right = '0'
        sandbox.style.bottom = '0'
        sandbox.style.backgroundColor = '#f8f9fa'
        sandbox.style.zIndex = '9999999'
        sandbox.style.overflowY = 'auto'
        document.body.appendChild(sandbox)
      }
    })
  })

  test('should render container with divided options', async ({ page }) => {
    await page.evaluate(async () => {
      const sandbox = document.getElementById('test-sandbox')
      const listEl = document.createElement('atoll-list')
      listEl.id = 'test-list-divided'
      listEl.setAttribute('divided', 'true')

      const item1 = document.createElement('atoll-list-item')
      item1.setAttribute('title', 'Item 1')
      const item2 = document.createElement('atoll-list-item')
      item2.setAttribute('title', 'Item 2')

      listEl.appendChild(item1)
      listEl.appendChild(item2)
      sandbox.appendChild(listEl)

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
      const sandbox = document.getElementById('test-sandbox')
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
      sandbox.appendChild(container)

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
      const sandbox = document.getElementById('test-sandbox')
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

      sandbox.appendChild(item)

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
      const sandbox = document.getElementById('test-sandbox')
      const item = document.createElement('atoll-list-item')
      item.id = 'clickable-item'
      item.setAttribute('title', 'Interactive Item')
      item.setAttribute('clickable', 'true')

      window.itemClicks = []
      item.addEventListener('atoll-item-click', (e) => {
        window.itemClicks.push(e.detail)
      })

      sandbox.appendChild(item)

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
      const sandbox = document.getElementById('test-sandbox')
      const itemEl = document.createElement('atoll-list-item')
      itemEl.id = 'disabled-item'
      itemEl.setAttribute('title', 'Disabled Item')
      itemEl.setAttribute('clickable', 'true')
      itemEl.setAttribute('disabled', 'true')

      window.disabledClicks = []
      itemEl.addEventListener('atoll-item-click', (e) => {
        window.disabledClicks.push(e.detail)
      })

      sandbox.appendChild(itemEl)

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

  test('should support atoll-checkbox behavior independently', async ({ page }) => {
    await page.evaluate(async () => {
      const sandbox = document.getElementById('test-sandbox')
      const cb = document.createElement('atoll-checkbox')
      cb.id = 'test-cb-1'
      cb.setAttribute('checked', 'true')
      sandbox.appendChild(cb)
      await customElements.whenDefined('atoll-checkbox')
    })

    const cbLoc = page.locator('#test-cb-1')
    await expect(cbLoc.locator('.atoll-checkbox')).toHaveClass(/checked/)

    // Test toggle click
    await cbLoc.locator('.atoll-checkbox').click()
    await expect(cbLoc.locator('.atoll-checkbox')).not.toHaveClass(/checked/)
  })

  test('should support selection-mode click and toggle and event dispatching', async ({ page }) => {
    await page.evaluate(async () => {
      const sandbox = document.getElementById('test-sandbox')
      const item = document.createElement('atoll-list-item')
      item.id = 'selection-item'
      item.setAttribute('title', 'Selectable Person')
      item.setAttribute('mode', 'selection')
      item.setAttribute('checked', 'false')

      window.selectionChanges = []
      item.addEventListener('atoll-selection-change', (e) => {
        window.selectionChanges.push(e.detail)
      })

      sandbox.appendChild(item)
      await customElements.whenDefined('atoll-list-item')
    })

    const itemLoc = page.locator('#selection-item')
    const rootDiv = itemLoc.locator('.atoll-list-item')

    // Click the row to check it
    await rootDiv.click()
    let changes = await page.evaluate(() => window.selectionChanges)
    expect(changes.length).toBe(1)
    expect(changes[0][0].checked).toBe(true)
    expect(changes[0][0].value).toBe('Selectable Person')

    // Click again to uncheck it
    await rootDiv.click()
    changes = await page.evaluate(() => window.selectionChanges)
    expect(changes.length).toBe(2)
    expect(changes[1][0].checked).toBe(false)
  })

  test('should support delete-mode action triggers', async ({ page }) => {
    await page.evaluate(async () => {
      const sandbox = document.getElementById('test-sandbox')
      const item = document.createElement('atoll-list-item')
      item.id = 'delete-item'
      item.setAttribute('title', 'Deletable Person')
      item.setAttribute('mode', 'edit')

      window.itemActions = []
      item.addEventListener('atoll-item-action', (e) => {
        window.itemActions.push(e.detail)
      })

      sandbox.appendChild(item)
      await customElements.whenDefined('atoll-list-item')
    })

    const itemLoc = page.locator('#delete-item')
    const deleteIcon = itemLoc.locator('.atoll-list-item-delete-icon')

    await expect(deleteIcon).toBeVisible()
    await deleteIcon.click()

    const actions = await page.evaluate(() => window.itemActions)
    expect(actions.length).toBe(1)
    expect(actions[0].action).toBe('delete')
    expect(actions[0].value).toBe('Deletable Person')
  })

  test('should support loading attribute with skeleton placeholders and prevent interaction', async ({ page }) => {
    await page.evaluate(async () => {
      const sandbox = document.getElementById('test-sandbox')
      const item = document.createElement('atoll-list-item')
      item.id = 'loading-item'
      item.setAttribute('title', 'Loaded Title')
      item.setAttribute('loading', 'true')
      item.setAttribute('clickable', 'true')

      window.loadingClicks = []
      item.addEventListener('atoll-item-click', (e) => {
        window.loadingClicks.push(e.detail)
      })

      sandbox.appendChild(item)
      await customElements.whenDefined('atoll-list-item')
    })

    const itemLoc = page.locator('#loading-item')
    const rootDiv = itemLoc.locator('.atoll-list-item')

    // Confirm disabled roles/tabindex
    await expect(rootDiv).toHaveAttribute('tabindex', '-1')
    await expect(rootDiv).toHaveClass(/atoll-list-item-loading/)

    // Confirm placeholders are visible
    const avatarPlaceholder = itemLoc.locator('.placeholder.rounded-circle')
    await expect(avatarPlaceholder).toBeVisible()

    const waveWrapper = itemLoc.locator('.placeholder-wave')
    await expect(waveWrapper).toBeVisible()

    // Confirm that the actual title text/slots are hidden
    const titleSlot = itemLoc.locator('.atoll-list-item-content')
    await expect(titleSlot).toBeHidden()

    // Confirm clicks do nothing
    await rootDiv.click({ force: true })
    const clicks = await page.evaluate(() => window.loadingClicks)
    expect(clicks.length).toBe(0)
  })

  test('should render visual matrix of states for screenshot', async ({ page }) => {
    await page.evaluate(() => {
      const sandbox = document.getElementById('test-sandbox')

      // Trigger loading of all required components programmatically first so they are upgraded
      document.createElement('atoll-list')
      document.createElement('atoll-list-item')
      document.createElement('atoll-checkbox')
      document.createElement('atoll-profile')
      document.createElement('atoll-icon')

      // Setup a clean layout inside our sandbox for the visual verification matching list_matrix.png exactly
      sandbox.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 24px; padding: 40px; background-color: #f8f9fa; font-family: sans-serif; color: #111; max-width: 600px; margin: 0 auto;">
          <h2 style="font-size: 28px; font-weight: 700; margin-bottom: 4px;">Atoll State-Driven List Matrix</h2>
          
          <div>
            <h4 style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">1. Default Navigation Mode</h4>
            <atoll-list divided="true" id="standard-list">
              <atoll-list-item title="Alice" description="Hey, where are we meeting?" timestamp="10:30 AM" badge="1" clickable="true" id="v-alice">
                <atoll-profile slot="leading" size="md" name="Alice"></atoll-profile>
              </atoll-list-item>
              <atoll-list-item title="Bob" description="Sent a photo." timestamp="Yesterday" clickable="true" id="v-bob">
                <atoll-profile slot="leading" size="md" name="Bob"></atoll-profile>
              </atoll-list-item>
              <atoll-list-item title="Charlie" description="Away on vacation" disabled="true" clickable="true" id="v-charlie">
                <atoll-profile slot="leading" size="md" name="Charlie"></atoll-profile>
              </atoll-list-item>
            </atoll-list>
          </div>

          <div>
            <h4 style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">2. Selection Mode (Contextual Checkboxes)</h4>
            <atoll-list mode="selection" divided="true" id="selection-list">
              <atoll-list-item title="Alice Smith" description="Selected contact" checked="true" clickable="true" id="v-alice-smith">
                <atoll-profile slot="leading" size="md" name="Alice Smith"></atoll-profile>
              </atoll-list-item>
              <atoll-list-item title="Bob Jones" description="Unselected contact" checked="false" clickable="true" id="v-bob-jones">
                <atoll-profile slot="leading" size="md" name="Bob Jones"></atoll-profile>
              </atoll-list-item>
            </atoll-list>
          </div>

          <div>
            <h4 style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">3. Edit / Delete Mode (Contextual Red Minus Action)</h4>
            <atoll-list mode="edit" divided="true" id="delete-list">
              <atoll-list-item title="Blocked Contact 1" description="Blocked on 10/12" clickable="true" id="v-blocked-1">
                <atoll-profile slot="leading" size="md" name="Blocked Contact 1"></atoll-profile>
              </atoll-list-item>
              <atoll-list-item title="Blocked Contact 2" description="Blocked on 08/15" clickable="true" id="v-blocked-2">
                <atoll-profile slot="leading" size="md" name="Blocked Contact 2"></atoll-profile>
              </atoll-list-item>
            </atoll-list>
          </div>

          <div>
            <h4 style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">4. Reorder Mode (Dynamic Right Drag Handles)</h4>
            <atoll-list mode="reorder" divided="true" id="reorder-list">
              <atoll-list-item title="Pinned Room 1" description="High priority thread" clickable="true" id="v-pinned-1">
                <atoll-profile slot="leading" size="md" name="Pinned Room 1"></atoll-profile>
              </atoll-list-item>
              <atoll-list-item title="Pinned Room 2" description="Secondary thread" clickable="true" id="v-pinned-2">
                <atoll-profile slot="leading" size="md" name="Pinned Room 2"></atoll-profile>
              </atoll-list-item>
            </atoll-list>
          </div>

          <div>
            <h4 style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">5. Highlighted & Selected States</h4>
            <atoll-list id="highlighted-selected-list">
              <atoll-list-item title="Selected Contact" description="Active selection state" selected="true" clickable="true" id="v-selected">
                <atoll-profile slot="leading" size="md" name="Selected Contact"></atoll-profile>
              </atoll-list-item>
              <atoll-list-item title="Highlighted Item" description="Soft subtle highlight tint" highlighted="true" clickable="true" id="v-highlighted">
                <atoll-profile slot="leading" size="md" name="Highlighted Item"></atoll-profile>
              </atoll-list-item>
            </atoll-list>
          </div>

          <div>
            <h4 style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">6. Loading Wave Placeholders</h4>
            <atoll-list divided="true" id="loading-list">
              <atoll-list-item loading="true" size="sm"></atoll-list-item>
              <atoll-list-item loading="true" size="md"></atoll-list-item>
              <atoll-list-item loading="true" size="lg"></atoll-list-item>
            </atoll-list>
          </div>
        </div>
      `
    })

    // Wait for all custom elements to be registered in the browser context robustly using Playwright's waitForFunction
    await page.waitForFunction(() => customElements.get('atoll-list'))
    await page.waitForFunction(() => customElements.get('atoll-list-item'))
    await page.waitForFunction(() => customElements.get('atoll-checkbox'))
    await page.waitForFunction(() => customElements.get('atoll-profile'))
    await page.waitForFunction(() => customElements.get('atoll-icon'))

    await page.setViewportSize({
      width: 1280,
      height: 1400
    })
    // Wait for components to fully load and render
    await page.waitForTimeout(2000)

    // Capture visual screenshot of full matrix container
    await page.locator('#test-sandbox > div').screenshot({ path: 'tests/e2e/screenshots/list_matrix.png' })
  })
})
