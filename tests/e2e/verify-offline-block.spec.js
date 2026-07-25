import { test, expect } from '@playwright/test'

test('should show connection required setup screen', async ({ browser }) => {
  const context = await browser.newContext({
    recordVideo: {
      dir: '/home/jules/verification/videos',
      size: { width: 800, height: 600 }
    }
  })
  const page = await context.newPage()

  // Clear storage and state
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  // Intercept the server_metadata collection endpoint to simulate offline on cold boot
  await page.route('**/api/collections/server_metadata/records', async (route) => {
    console.log('[PLAYWRIGHT INTERCEPT] Aborting server_metadata request to force cold boot offline.')
    await route.abort('failed')
  })

  await page.goto('/')
  await page.waitForTimeout(3000)

  // Take a screenshot of the "Connection Required" setup screen
  console.log('Taking screenshot...')
  await page.screenshot({ path: '/home/jules/verification/screenshots/verification.png' })

  await context.close()
})
