import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-slideshow Component Tests', () => {
  test('should initialize slideshow, render slots, and expose public API methods', async ({ page, mountComponent }) => {
    await mountComponent('atoll-slideshow', { loop: 'false', style: 'width: 600px; height: 400px;' }, `
      <div slot="header" class="slide-header">Gallery Header</div>
      <div class="slide" style="height: 100%; background: #e0f2fe; display: flex; align-items: center; justify-content: center;">Slide 1</div>
      <div class="slide" style="height: 100%; background: #fef08a; display: flex; align-items: center; justify-content: center;">Slide 2</div>
      <div class="slide" style="height: 100%; background: #bbf7d0; display: flex; align-items: center; justify-content: center;">Slide 3</div>
      <div slot="footer" class="slide-footer">Gallery Footer</div>
    `)

    const slideshowHost = page.locator('#test-component-root')
    const viewport = slideshowHost.locator('.atoll-slideshow-viewport')
    const container = slideshowHost.locator('.atoll-slideshow-container')

    await expect(slideshowHost).toBeVisible()
    await expect(viewport).toBeVisible()
    await expect(container).toBeVisible()
    await expect(slideshowHost.locator('.slide-header')).toContainText('Gallery Header')
    await expect(slideshowHost.locator('.slide-footer')).toContainText('Gallery Footer')

    // Verify public method delegates
    const apiAvailable = await slideshowHost.evaluate((el) => {
      return (
        typeof el.prev === 'function' &&
        typeof el.next === 'function' &&
        typeof el.to === 'function' &&
        typeof el.getSelectedIndex === 'function' &&
        typeof el.canScrollPrev === 'function' &&
        typeof el.canScrollNext === 'function'
      )
    })
    expect(apiAvailable).toBe(true)
  })

  test('should handle navigation buttons and update active index', async ({ page, mountComponent }) => {
    await mountComponent('atoll-slideshow', { style: 'width: 600px; height: 400px;' }, `
      <div class="slide" style="height: 100%;">Slide 1</div>
      <div class="slide" style="height: 100%;">Slide 2</div>
      <div class="slide" style="height: 100%;">Slide 3</div>
    `)

    const slideshowHost = page.locator('#test-component-root')
    const nextBtn = slideshowHost.locator('.atoll-slideshow-nav-btn.next')
    const prevBtn = slideshowHost.locator('.atoll-slideshow-nav-btn.prev')

    await expect(nextBtn).toBeVisible()

    // Initially at index 0, prev should be disabled
    await expect(prevBtn).toHaveAttribute('disabled', 'true')

    // Click Next
    await nextBtn.click()
    await page.waitForTimeout(300)

    const indexAfterNext = await slideshowHost.evaluate(el => el.getSelectedIndex())
    expect(indexAfterNext).toBe(1)

    // Now prev should be enabled
    await expect(prevBtn).not.toHaveAttribute('disabled', 'true')

    // Click Prev
    await prevBtn.click()
    await page.waitForTimeout(300)

    const indexAfterPrev = await slideshowHost.evaluate(el => el.getSelectedIndex())
    expect(indexAfterPrev).toBe(0)
  })

  test('should handle keyboard navigation with ArrowLeft and ArrowRight', async ({ page, mountComponent }) => {
    await mountComponent('atoll-slideshow', { keyboard: 'true', style: 'width: 600px; height: 400px;' }, `
      <div class="slide" style="height: 100%;">Slide 1</div>
      <div class="slide" style="height: 100%;">Slide 2</div>
    `)

    const slideshowHost = page.locator('#test-component-root')
    await slideshowHost.evaluate(el => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true }))
    })
    await page.waitForTimeout(300)

    const index = await slideshowHost.evaluate(el => el.getSelectedIndex())
    expect(index).toBe(1)

    await slideshowHost.evaluate(el => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', keyCode: 37, bubbles: true, cancelable: true }))
    })
    await page.waitForTimeout(300)

    const backIndex = await slideshowHost.evaluate(el => el.getSelectedIndex())
    expect(backIndex).toBe(0)
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

      const matrixWrapper = document.createElement('div')
      matrixWrapper.id = 'visual-matrix'
      matrixWrapper.style.cssText = 'display: flex; flex-direction: column; gap: 32px; padding: 48px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111); font-family: system-ui, sans-serif; max-width: 680px; margin: 0 auto;'

      const title = document.createElement('h2')
      title.style.cssText = 'margin: 0; font-size: 20px;'
      title.textContent = 'atoll-slideshow Visual Verification Matrix'
      matrixWrapper.appendChild(title)

      const card = document.createElement('div')
      card.style.cssText = 'height: 320px; border-radius: 16px; overflow: hidden; border: 1px solid var(--atoll-border-subtle, #e5e7eb); position: relative;'

      const slideshow = document.createElement('atoll-slideshow')
      slideshow.id = 'matrix-slideshow'

      const header = document.createElement('div')
      header.setAttribute('slot', 'header')
      header.style.cssText = 'padding: 12px 16px; font-weight: 600; background: var(--atoll-bg-surface-secondary, #f3f4f6);'
      header.textContent = 'Featured Gallery'
      slideshow.appendChild(header)

      const slide1 = document.createElement('div')
      slide1.style.cssText = 'height: 100%; background: #3b82f6; color: white; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold;'
      slide1.textContent = 'Slide One'
      slideshow.appendChild(slide1)

      const slide2 = document.createElement('div')
      slide2.style.cssText = 'height: 100%; background: #10b981; color: white; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold;'
      slide2.textContent = 'Slide Two'
      slideshow.appendChild(slide2)

      const slide3 = document.createElement('div')
      slide3.style.cssText = 'height: 100%; background: #f59e0b; color: white; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold;'
      slide3.textContent = 'Slide Three'
      slideshow.appendChild(slide3)

      const footer = document.createElement('div')
      footer.setAttribute('slot', 'footer')
      footer.style.cssText = 'padding: 10px 16px; font-size: 13px; color: var(--atoll-text-muted, #6b7280); background: var(--atoll-bg-surface-secondary, #f3f4f6);'
      footer.textContent = 'Swipe or click arrows to navigate'
      slideshow.appendChild(footer)

      card.appendChild(slideshow)
      matrixWrapper.appendChild(card)
      mountPoint.appendChild(matrixWrapper)
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('slideshow-verification-light', matrix)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('slideshow-verification-dark', matrix)
  })
})
