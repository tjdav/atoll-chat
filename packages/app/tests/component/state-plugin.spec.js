import { test, expect } from '@playwright/test'
import { stubAuth, seedSession } from '../helpers/storage-fixture.js'

test.use({ video: 'on' })

test.beforeEach(async ({ page }) => {
  await stubAuth(page)
  await seedSession(page)
  await page.goto('/app.html')
  await page.waitForSelector('messenger-shell', { timeout: 15000 })
})

test.describe('Global state plugin component delivery and reactivity', () => {
  test('1. The plugin context is delivered', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('cv-state-probe')
      document.body.appendChild(el)
    })

    const probe = page.locator('[data-testid="cv-state-probe"]')
    await expect(probe).toBeVisible()
    const definedText = page.locator('[data-testid="probe-defined"][data-ready="true"]')
    await expect(definedText).toHaveText('defined')
  })

  test('2. Writes are reactive', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('cv-state-probe')
      document.body.appendChild(el)
    })

    await page.waitForSelector('[data-testid="probe-defined"][data-ready="true"]')

    const writeBtn = page.locator('[data-testid="probe-write-btn"]')
    await writeBtn.click()

    const count = page.locator('[data-testid="probe-count"]')
    const val = page.locator('[data-testid="probe-val"]')

    await expect(count).toHaveText('1')
    await expect(val).toHaveText('a')
  })

  test('3. Subscriptions are per-key', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('cv-state-probe')
      document.body.appendChild(el)
    })

    await page.waitForSelector('[data-testid="probe-defined"][data-ready="true"]')

    const writeOtherBtn = page.locator('[data-testid="probe-write-other-btn"]')
    await writeOtherBtn.click()

    const count = page.locator('[data-testid="probe-count"]')
    await expect(count).toHaveText('0')
  })

  test('4. Signal cleanup', async ({ page }) => {
    const consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.evaluate(() => {
      const el = document.createElement('cv-state-probe')
      el.id = 'probe-1'
      document.body.appendChild(el)
    })

    await page.waitForSelector('#probe-1 [data-testid="probe-defined"][data-ready="true"]')

    await page.evaluate(() => {
      document.querySelector('#probe-1')?.remove()
    })

    await page.evaluate(() => {
      const el2 = document.createElement('cv-state-probe')
      el2.id = 'probe-2'
      document.body.appendChild(el2)
    })

    await page.waitForSelector('#probe-2 [data-testid="probe-defined"][data-ready="true"]')

    const writeBtn2 = page.locator('#probe-2 [data-testid="probe-write-btn"]')
    await writeBtn2.click()

    const count2 = page.locator('#probe-2 [data-testid="probe-count"]')
    await expect(count2).toHaveText('1')

    const statePluginErrors = consoleErrors.filter(err => /globalStore|createStateStore/i.test(err))
    expect(statePluginErrors).toEqual([])
  })

  test('5. Delete fires subscribers', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('cv-state-probe')
      document.body.appendChild(el)
    })

    await page.waitForSelector('[data-testid="probe-defined"][data-ready="true"]')

    const writeBtn = page.locator('[data-testid="probe-write-btn"]')
    await writeBtn.click()

    const count = page.locator('[data-testid="probe-count"]')
    const val = page.locator('[data-testid="probe-val"]')
    await expect(count).toHaveText('1')
    await expect(val).toHaveText('a')

    const deleteBtn = page.locator('[data-testid="probe-delete-btn"]')
    await deleteBtn.click()

    await expect(count).toHaveText('2')
    await expect(val).toHaveText('undefined')
  })
})
