import { test as base } from '@playwright/test'

export const test = base.extend({
  page: async ({ page }, use) => {
    // Store the original goto method
    const originalGoto = page.goto.bind(page)

    // Override the goto method
    page.goto = async (url, options) => {
      const response = await originalGoto(url, options)

      // Wait for Coralite to be ready
      await page.waitForFunction(() => window.__coralite_ready__ !== undefined)
      await page.evaluate(() => window.__coralite_ready__)

      return response
    }

    // Pass the modified page object to the tests
    await use(page)
  }
})

export { expect } from '@playwright/test'
