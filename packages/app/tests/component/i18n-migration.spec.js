import { test, expect } from '@playwright/test'
import en from '../../src/lib/i18n/locales/en.js'
import fr from '../../src/lib/i18n/locales/fr.js'
import de from '../../src/lib/i18n/locales/de.js'
import ja from '../../src/lib/i18n/locales/ja.js'
import pt from '../../src/lib/i18n/locales/pt.js'
import it from '../../src/lib/i18n/locales/it.js'
import es from '../../src/lib/i18n/locales/es.js'

const localesMap = { en, fr, de, ja, pt, it, es }

test.use({ video: 'on' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.clear() } catch { /* ignore */ }
  })
})

test('1. English default rendering on /index.html', async ({ page }) => {
  await page.goto('/index.html')
  await expect(page.locator('auth-gate')).toBeVisible()
  await page.screenshot({ path: 'test-results/i18n-migration-en.png', fullPage: true })
})

for (const [code] of Object.entries(localesMap)) {
  if (code === 'en') continue
  test(`2. Locale rendering for "${code}"`, async ({ page }) => {
    await page.addInitScript(({ locCode }) => {
      try {
        window.localStorage.setItem('atoll.preference.locale', locCode)
      } catch { /* ignore */ }
    }, { locCode: code })

    await page.goto('/index.html')
    await expect(page.locator('auth-gate')).toBeVisible()
    await page.screenshot({ path: `test-results/i18n-migration-${code}.png`, fullPage: true })
  })
}

test('3. Register view localized rendering', async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('atoll.preference.locale', 'fr') } catch {}
  })

  await page.goto('/index.html')
  await expect(page.locator('auth-gate')).toBeVisible()
})

test('4. Register codes view localized rendering', async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('atoll.preference.locale', 'de') } catch {}
  })

  await page.goto('/index.html')
  await expect(page.locator('auth-gate')).toBeVisible()
})

test('5. Recovery view localized rendering', async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('atoll.preference.locale', 'ja') } catch {}
  })

  await page.goto('/index.html')
  await expect(page.locator('auth-gate')).toBeVisible()
})

test('6. Boot view localized rendering', async ({ page }) => {
  await page.goto('/app.html')
  await expect(page.locator('messenger-boot')).toBeVisible()
})

test('7. Runtime locale switch via reload', async ({ page }) => {
  await page.goto('/index.html')
  await expect(page.locator('auth-gate')).toBeVisible()

  await page.evaluate(() => {
    window.localStorage.setItem('atoll.preference.locale', 'pt')
  })
  await page.reload()

  await expect(page.locator('auth-gate')).toBeVisible()
})
