import { test, expect } from '@playwright/test'
import { stubAuth, seedSession, loadWithFixture } from '../helpers/storage-fixture.js'

test.use({ video: 'on' })

test('composer component interactive flows', async ({ page }) => {
  await stubAuth(page)
  await seedSession(page)
  await loadWithFixture(page, { seed: 'chatEmpty', path: '/app.html?rail=core.chat&detail=chat&id=r_1' })

  const composer = page.locator('message-composer')
  await expect(composer).toBeVisible()

  const sendBtn = composer.locator('.composer__btn--send')
  const textarea = composer.locator('textarea')

  // 1. Empty composer disables send
  await expect(sendBtn).toBeDisabled()

  // 2. Typing enables send
  await textarea.fill('Hello world')
  await expect(composer).toHaveAttribute('has-text', '')
  await expect(sendBtn).toBeEnabled()

  // 3. Shift+Enter inserts newline without sending
  await textarea.fill('line1')
  await textarea.press('Shift+Enter')
  await textarea.type('line2')
  await expect(textarea).toHaveValue('line1\nline2')

  // 4. Click stub buttons
  await composer.locator('.composer__btn--attach').click({ force: true })
  await composer.locator('.composer__btn--emoji').click({ force: true })
  await composer.locator('.composer__btn--speak').click({ force: true })

  // 5. Enter sends message
  await textarea.fill('Hello from composer test')
  await textarea.press('Enter')
  await expect(textarea).toHaveValue('')

  await page.screenshot({ path: 'test-results/composer-pending.png', fullPage: true })
})
