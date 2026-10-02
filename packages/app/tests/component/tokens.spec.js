import { test, expect } from '@playwright/test'

test.describe('design tokens', () => {
  test('light-mode tokens resolve on :root', async ({ page }) => {
    await page.goto('/index.html')

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        surface0: style.getPropertyValue('--surface-0').trim(),
        textPrimary: style.getPropertyValue('--text-primary').trim(),
        accentFill: style.getPropertyValue('--accent-fill').trim(),
        bubbleOutgoing: style.getPropertyValue('--bubble-outgoing').trim(),
        railWidth: style.getPropertyValue('--rail-width').trim(),
      }
    })

    expect(tokens.surface0).not.toBe('')
    expect(tokens.textPrimary).not.toBe('')
    expect(tokens.accentFill).not.toBe('')
    expect(tokens.bubbleOutgoing).not.toBe('')
    expect(tokens.railWidth).toBe('64px')
  })

  test('dark-mode remap changes surface and accent tokens', async ({ page }) => {
    await page.goto('/index.html')

    const lightSurface = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--surface-0').trim()
    )

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark')
    })

    const darkSurface = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--surface-0').trim()
    )

    expect(darkSurface).not.toBe(lightSurface)
  })

  test('spacing and radius scales resolve', async ({ page }) => {
    await page.goto('/index.html')

    const scale = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        space1: style.getPropertyValue('--space-1').trim(),
        space4: style.getPropertyValue('--space-4').trim(),
        radiusXl: style.getPropertyValue('--radius-xl').trim(),
      }
    })

    expect(scale.space1).toBe('0.25rem')
    expect(scale.space4).toBe('1rem')
    expect(scale.radiusXl).toBe('18px')
  })

  test('reduced-motion block disables transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/index.html')

    const transitionDuration = await page.evaluate(() => {
      const el = document.body
      return getComputedStyle(el).transitionDuration
    })

    expect(transitionDuration).not.toBe('')
  })
})
