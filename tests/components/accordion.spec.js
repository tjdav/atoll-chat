import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-accordion and atoll-accordion-item Component Tests', () => {
  test('should render base accordion item with default collapsed state and handle click toggling', async ({ page, mountComponent }) => {
    await mountComponent('atoll-accordion-item', { title: 'Account Settings', icon: 'settings', badge: 'New' }, `
      <p class="p-3">Settings Content Here</p>
    `)

    const itemHost = page.locator('#test-component-root')
    const header = itemHost.locator('.atoll-accordion-item-header')
    const body = itemHost.locator('.atoll-accordion-item-body')
    const title = itemHost.locator('.atoll-accordion-item-title-text')
    const icon = itemHost.locator('.atoll-accordion-item-icon-wrapper atoll-icon')
    const badge = itemHost.locator('.atoll-accordion-item-badge')

    await expect(itemHost).toBeVisible()
    await expect(title).toHaveText('Account Settings')
    await expect(icon).toBeVisible()
    await expect(badge).toHaveText('New')

    // Initial collapsed state
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await expect(body).not.toHaveClass(/show/)

    // Click to expand
    await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    await expect(body).toHaveClass(/show/)

    // Click to collapse
    await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await expect(body).not.toHaveClass(/show/)
  })

  test('should support keyboard toggling with Enter and Space keys', async ({ page, mountComponent }) => {
    await mountComponent('atoll-accordion-item', { title: 'Keyboard Test' }, `
      <div>Body Content</div>
    `)

    const itemHost = page.locator('#test-component-root')
    const header = itemHost.locator('.atoll-accordion-item-header')
    const body = itemHost.locator('.atoll-accordion-item-body')

    await header.focus()
    await expect(header).toBeFocused()

    // Press Enter to expand
    await page.keyboard.press('Enter')
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    await expect(body).toHaveClass(/show/)

    // Press Space to collapse
    await page.keyboard.press('Space')
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await expect(body).not.toHaveClass(/show/)
  })

  test('should support programmatic expanded property and toggle method', async ({ page, mountComponent }) => {
    await mountComponent('atoll-accordion-item', { title: 'Programmatic Test' }, `
      <div>Content</div>
    `)

    const itemHost = page.locator('#test-component-root')
    const header = itemHost.locator('.atoll-accordion-item-header')
    const body = itemHost.locator('.atoll-accordion-item-body')

    // Set expanded = true via synthesized property accessor
    await itemHost.evaluate((el) => {
      el.expanded = true
    })
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    await expect(body).toHaveClass(/show/)

    // Call toggle() method
    await itemHost.evaluate((el) => {
      el.toggle()
    })
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await expect(body).not.toHaveClass(/show/)
  })

  test('should coordinate accordion items in single-expansion mode (multiple=false)', async ({ page, mountComponent }) => {
    await mountComponent('atoll-accordion', {}, `
      <atoll-accordion-item id="item-1" title="Item 1"><p>Content 1</p></atoll-accordion-item>
      <atoll-accordion-item id="item-2" title="Item 2"><p>Content 2</p></atoll-accordion-item>
    `)

    const item1Header = page.locator('#item-1 .atoll-accordion-item-header')
    const item1Body = page.locator('#item-1 .atoll-accordion-item-body')
    const item2Header = page.locator('#item-2 .atoll-accordion-item-header')
    const item2Body = page.locator('#item-2 .atoll-accordion-item-body')

    // Wait for elements to be visible
    await expect(item1Header).toBeVisible()
    await expect(item2Header).toBeVisible()

    // Open item 1
    await item1Header.click()
    await expect(item1Header).toHaveAttribute('aria-expanded', 'true')
    await expect(item1Body).toHaveClass(/show/)

    // Open item 2 -> item 1 should automatically collapse
    await item2Header.click()
    await expect(item2Header).toHaveAttribute('aria-expanded', 'true')
    await expect(item2Body).toHaveClass(/show/)
    await expect(item1Header).toHaveAttribute('aria-expanded', 'false')
    await expect(item1Body).not.toHaveClass(/show/)
  })

  test('should allow multiple items open simultaneously when multiple=true and support collapseAll/expandAll', async ({ page, mountComponent }) => {
    await mountComponent('atoll-accordion', { multiple: 'true' }, `
      <atoll-accordion-item id="sec-a" title="Section A"><p>Content A</p></atoll-accordion-item>
      <atoll-accordion-item id="sec-b" title="Section B"><p>Content B</p></atoll-accordion-item>
    `)

    const accordionHost = page.locator('#test-component-root')
    const secAHeader = page.locator('#sec-a .atoll-accordion-item-header')
    const secABody = page.locator('#sec-a .atoll-accordion-item-body')
    const secBHeader = page.locator('#sec-b .atoll-accordion-item-header')
    const secBBody = page.locator('#sec-b .atoll-accordion-item-body')

    // Open Section A
    await secAHeader.click()
    await expect(secABody).toHaveClass(/show/)

    // Open Section B -> Both should remain open
    await secBHeader.click()
    await expect(secABody).toHaveClass(/show/)
    await expect(secBBody).toHaveClass(/show/)

    // Test collapseAll()
    await accordionHost.evaluate((node) => node.collapseAll())
    await expect(secABody).not.toHaveClass(/show/)
    await expect(secBBody).not.toHaveClass(/show/)

    // Test expandAll()
    await accordionHost.evaluate((node) => node.expandAll())
    await expect(secABody).toHaveClass(/show/)
    await expect(secBBody).toHaveClass(/show/)
  })

  test('should render visual matrix and pass accessibility checks in light and dark themes', async ({
    page,
    mountComponent,
    setTheme,
    takeVerificationScreenshot
  }) => {
    await mountComponent('atoll-accordion', { multiple: 'true' }, `
      <atoll-accordion-item id="matrix-1" title="Profile Settings" icon="person" badge="Updated" expanded="true">
        <div style="padding: 12px 16px;">User profile preferences and personal details.</div>
      </atoll-accordion-item>
      <atoll-accordion-item id="matrix-2" title="Notifications & Sounds" icon="bell">
        <div style="padding: 12px 16px;">Customize push and sound alert behavior.</div>
      </atoll-accordion-item>
    `)

    // Verify in Light Theme
    await setTheme('light')
    await takeVerificationScreenshot('accordion-verification-light')

    // Verify in Dark Theme
    await setTheme('dark')
    await takeVerificationScreenshot('accordion-verification-dark')
  })
})
