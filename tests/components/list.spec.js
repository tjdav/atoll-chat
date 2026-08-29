import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-list and atoll-list-item Component Tests', () => {
  test('should render basic list and list item with title, description, and timestamp', async ({ page, mountComponent }) => {
    await mountComponent('atoll-list', { divided: 'true' })

    await page.evaluate(() => {
      const list = document.getElementById('test-component-root')

      const item = document.createElement('atoll-list-item')
      item.id = 'item-1'
      item.setAttribute('title', 'Alice Morgan')
      item.setAttribute('description', 'Hey! How are you?')
      item.setAttribute('timestamp', '10:42 AM')

      const profile = document.createElement('atoll-profile')
      profile.setAttribute('slot', 'left')
      profile.setAttribute('size', 'md')
      profile.setAttribute('name', 'Alice Morgan')

      item.appendChild(profile)
      list.appendChild(item)
    })

    const listHost = page.locator('#test-component-root')
    const item = listHost.locator('#item-1')
    const innerRow = item.locator('.atoll-list-item')
    const title = item.locator('.atoll-list-item-title')
    const desc = item.locator('.atoll-list-item-description')
    const time = item.locator('.atoll-list-item-timestamp')

    await expect(listHost).toBeAttached()
    await expect(innerRow).toBeVisible()
    await expect(title).toHaveText('Alice Morgan')
    await expect(desc).toHaveText('Hey! How are you?')
    await expect(time).toHaveText('10:42 AM')
  })

  test('should support size modifiers (sm, md, lg)', async ({ page, mountComponent }) => {
    await mountComponent('atoll-list-item', {
      title: 'Size Test',
      size: 'sm'
    })

    const itemHost = page.locator('#test-component-root')
    const innerRow = itemHost.locator('.atoll-list-item')

    await expect(innerRow).toHaveCSS('min-height', '48px')

    await itemHost.evaluate(el => el.setAttribute('size', 'lg'))
    await expect(innerRow).toHaveCSS('min-height', '72px')
  })

  test('should broadcast mode from atoll-list to child items and trigger selection changes', async ({ page, mountComponent }) => {
    await mountComponent('atoll-list', {})

    await page.evaluate(() => {
      const list = document.getElementById('test-component-root')

      const itemA = document.createElement('atoll-list-item')
      itemA.id = 'item-a'
      itemA.setAttribute('title', 'Item A')
      itemA.setAttribute('value', 'val-a')

      const itemB = document.createElement('atoll-list-item')
      itemB.id = 'item-b'
      itemB.setAttribute('title', 'Item B')
      itemB.setAttribute('value', 'val-b')

      list.appendChild(itemA)
      list.appendChild(itemB)
    })

    const listHost = page.locator('#test-component-root')
    const itemA = listHost.locator('#item-a')
    const itemB = listHost.locator('#item-b')

    // Switch to selection mode
    await listHost.evaluate(el => el.setMode('selection'))
    await expect(itemA).toHaveAttribute('mode', 'selection')
    await expect(itemB).toHaveAttribute('mode', 'selection')

    const cbA = itemA.locator('atoll-checkbox')
    await expect(cbA).toBeVisible()

    // Test selectAll and getSelectedItems
    await listHost.evaluate(el => el.selectAll())
    await expect(itemA).toHaveAttribute('checked', '')
    await expect(itemB).toHaveAttribute('checked', '')

    const selectedCount = await listHost.evaluate(el => el.getSelectedItems().length)
    expect(selectedCount).toBe(2)

    // Clear selection
    await listHost.evaluate(el => el.clearSelection())
    const clearedCount = await listHost.evaluate(el => el.getSelectedItems().length)
    expect(clearedCount).toBe(0)
  })

  test('should render edit mode with minus button and reorder mode with drag handles', async ({ page, mountComponent }) => {
    await mountComponent('atoll-list', {})

    await page.evaluate(() => {
      const list = document.getElementById('test-component-root')

      const item = document.createElement('atoll-list-item')
      item.id = 'item-test'
      item.setAttribute('title', 'Interactive Item')

      list.appendChild(item)
    })

    const listHost = page.locator('#test-component-root')
    const item = listHost.locator('#item-test')

    // Edit mode
    await listHost.evaluate(el => el.setMode('edit'))
    const deleteIcon = item.locator('.atoll-list-item-delete-icon')
    await expect(deleteIcon).toBeVisible()

    // Reorder mode
    await listHost.evaluate(el => el.setMode('reorder'))
    const reorderHandle = item.locator('.atoll-list-item-reorder')
    await expect(reorderHandle).toBeVisible()
  })

  test('should handle clicks, focus, and Enter/Space keyboard trigger interaction', async ({ page, mountComponent }) => {
    await mountComponent('atoll-list-item', {
      title: 'Interactive Item',
      clickable: true
    })

    await page.evaluate(() => {
      const item = document.getElementById('test-component-root')
      window.itemClicks = []
      item.addEventListener('atoll-item-click', (e) => {
        window.itemClicks.push(e.detail)
      })
    })

    const itemHost = page.locator('#test-component-root')
    const innerRow = itemHost.locator('.atoll-list-item')

    await expect(innerRow).toHaveAttribute('role', 'button')
    await expect(innerRow).toHaveAttribute('tabindex', '0')

    // Click trigger
    await innerRow.click()
    let clicks = await page.evaluate(() => window.itemClicks)
    expect(clicks.length).toBe(1)
    expect(clicks[0].title).toBe('Interactive Item')

    // Keydown trigger: Enter
    await innerRow.focus()
    await page.keyboard.press('Enter')
    clicks = await page.evaluate(() => window.itemClicks)
    expect(clicks.length).toBe(2)

    // Keydown trigger: Space
    await page.keyboard.press(' ')
    clicks = await page.evaluate(() => window.itemClicks)
    expect(clicks.length).toBe(3)
  })

  test('should respect disabled status and block interactions', async ({ page, mountComponent }) => {
    await mountComponent('atoll-list-item', {
      title: 'Disabled Item',
      clickable: true,
      disabled: true
    })

    await page.evaluate(() => {
      const item = document.getElementById('test-component-root')
      window.disabledClicks = []
      item.addEventListener('atoll-item-click', (e) => {
        window.disabledClicks.push(e.detail)
      })
    })

    const itemHost = page.locator('#test-component-root')
    const innerRow = itemHost.locator('.atoll-list-item')

    await expect(innerRow).toHaveAttribute('tabindex', '-1')

    // Click trigger attempt
    await innerRow.click({ force: true })
    const clicks = await page.evaluate(() => window.disabledClicks)
    expect(clicks.length).toBe(0)
  })

  test('should support loading state with wave placeholders', async ({ page, mountComponent }) => {
    await mountComponent('atoll-list-item', {
      title: 'Loaded Title',
      loading: true,
      clickable: true
    })

    const itemHost = page.locator('#test-component-root')
    const innerRow = itemHost.locator('.atoll-list-item')

    await expect(innerRow).toHaveAttribute('tabindex', '-1')

    const avatarPlaceholder = itemHost.locator('.placeholder.rounded-circle')
    await expect(avatarPlaceholder).toBeVisible()

    const waveWrapper = itemHost.locator('.placeholder-wave')
    await expect(waveWrapper).toBeVisible()

    const titleSlot = itemHost.locator('.atoll-list-item-content')
    await expect(titleSlot).toBeHidden()
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
      matrix.style.cssText = 'display: flex; flex-direction: column; gap: 32px; padding: 32px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111); font-family: system-ui, sans-serif; max-width: 540px; margin: 0 auto;'

      const title = document.createElement('h2')
      title.style.cssText = 'margin: 0; font-size: 20px;'
      title.textContent = 'atoll-list & atoll-list-item Visual Verification Matrix'
      matrix.appendChild(title)

      mountPoint.appendChild(matrix)

      const createItem = (attrs, profileName = '') => {
        const item = document.createElement('atoll-list-item')
        Object.entries(attrs).forEach(([k, v]) => item.setAttribute(k, v))
        if (profileName) {
          const profile = document.createElement('atoll-profile')
          profile.setAttribute('slot', 'left')
          profile.setAttribute('size', 'md')
          profile.setAttribute('name', profileName)
          item.appendChild(profile)
        }
        return item
      }

      // Section 1: Standard Default List with Badges and Chevron
      const list1 = document.createElement('atoll-list')
      list1.setAttribute('divided', 'true')
      list1.appendChild(createItem({ title: 'Design System Channel', description: 'Alex: The component library is updated.', timestamp: '12:30 PM', badge: '4', clickable: 'true' }, 'Design System Channel'))
      list1.appendChild(createItem({ title: 'Security Notifications', description: 'New login from Firefox on Linux.', timestamp: 'Yesterday', chevron: 'true', clickable: 'true' }, 'Security Notifications'))
      list1.appendChild(createItem({ title: 'Highlighted Active Thread', description: 'Active chatroom selection.', selected: 'true', clickable: 'true' }, 'Highlighted Active Thread'))
      matrix.appendChild(list1)

      // Section 2: Selection Mode List
      const list2 = document.createElement('atoll-list')
      list2.setAttribute('mode', 'selection')
      list2.setAttribute('divided', 'true')
      list2.appendChild(createItem({ title: 'Archived Project 1', description: 'Last active 2 weeks ago', checked: 'true' }, 'Archived Project 1'))
      list2.appendChild(createItem({ title: 'Archived Project 2', description: 'Last active 1 month ago' }, 'Archived Project 2'))
      matrix.appendChild(list2)

      // Section 3: Edit / Delete Mode
      const list3 = document.createElement('atoll-list')
      list3.setAttribute('mode', 'edit')
      list3.setAttribute('divided', 'true')
      list3.appendChild(createItem({ title: 'Blocked Contact 1', description: 'Blocked on 10/12' }, 'Blocked Contact 1'))
      list3.appendChild(createItem({ title: 'Blocked Contact 2', description: 'Blocked on 08/15' }, 'Blocked Contact 2'))
      matrix.appendChild(list3)

      // Section 4: Reorder Mode
      const list4 = document.createElement('atoll-list')
      list4.setAttribute('mode', 'reorder')
      list4.setAttribute('divided', 'true')
      list4.appendChild(createItem({ title: 'Pinned Room 1', description: 'High priority thread' }, 'Pinned Room 1'))
      list4.appendChild(createItem({ title: 'Pinned Room 2', description: 'Secondary thread' }, 'Pinned Room 2'))
      matrix.appendChild(list4)

      // Section 5: Loading State
      const list5 = document.createElement('atoll-list')
      list5.setAttribute('divided', 'true')
      list5.appendChild(createItem({ loading: 'true', size: 'sm' }))
      list5.appendChild(createItem({ loading: 'true', size: 'md' }))
      list5.appendChild(createItem({ loading: 'true', size: 'lg' }))
      matrix.appendChild(list5)
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('list-verification-light', matrix)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('list-verification-dark', matrix)
  })
})
