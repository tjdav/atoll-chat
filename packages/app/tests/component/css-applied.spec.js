import { test, expect } from '@playwright/test'

test.use({ video: 'on' })

test.describe('CSS is bundled and applied', () => {
  test('design tokens resolve and surface background applies', async ({ page }) => {
    await page.goto('/index.html')

    const tokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement)
      return {
        surface0: s.getPropertyValue('--surface-0').trim(),
        accent500: s.getPropertyValue('--accent-500').trim(),
        railWidth: s.getPropertyValue('--rail-width').trim(),
        htmlBg: s.backgroundColor,
        bodyBg: getComputedStyle(document.body).backgroundColor
      }
    })

    expect(tokens.surface0).not.toBe('')
    expect(tokens.accent500).not.toBe('')
    expect(tokens.railWidth).toBe('64px')
    expect(tokens.htmlBg).not.toBe('rgba(0, 0, 0, 0)')

    await page.screenshot({ path: 'test-results/css-applied.png', fullPage: true })
  })

  test('the served stylesheet contains bundled tokens, not @import', async ({ page }) => {
    await page.goto('/index.html')

    const cssText = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="stylesheet"]')
      if (!link) return null
      const res = await fetch(link.href)
      return res.text()
    })

    expect(cssText).not.toBeNull()
    expect(cssText).toContain('--accent-500')
    expect(cssText).not.toMatch(/(^|\n)\s*@import\b/)
  })
})
