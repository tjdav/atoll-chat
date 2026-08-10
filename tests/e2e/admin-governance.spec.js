import { test, expect } from './fixtures/base-test.js'

test.describe('Super-User Administration & Zero-Knowledge Delegated Invite System', () => {

  test('should register first user as owner and subsequent users as standard, then verify admin endpoints', async ({ page, loginApp }) => {
    // Login as Alice (who is promoted to Owner in the DB)
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Expect app layout to be visible
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })

    // Navigate to Settings page
    await page.locator('[data-testid$="profileBtn"]').click()
    await page.locator('[data-testid$="btnSettings"]').click()

    // Verify ADMINISTRATION navbar section exists for Owner (Alice)
    await expect(page.locator('[data-testid$="nav-admin-overview"]')).toBeVisible()
    await expect(page.locator('[data-testid$="nav-admin-trust"]')).toBeVisible()
    await expect(page.locator('[data-testid$="nav-admin-requests"]')).toBeVisible()

    // Go to overview and verify statistics
    await page.locator('[data-testid$="nav-admin-overview"]').click()
    await expect(page.locator('[data-testid$="statTotalUsers"]')).not.toContainText('--')

    // Change delegation mode and save
    await page.locator('[data-testid$="modeStrict"]').click()
    await page.locator('[data-testid$="btnSaveGovernance"]').click()
    await expect(page.locator('[data-testid$="saveSuccessAlert"]')).toBeVisible()

    // Restore to delegated mode and save
    await page.locator('[data-testid$="modeDelegated"]').click()
    await page.locator('[data-testid$="btnSaveGovernance"]').click()
    await expect(page.locator('[data-testid$="saveSuccessAlert"]')).toBeVisible()

    // Check trust matrix
    await page.locator('[data-testid$="nav-admin-trust"]').click()
    await expect(page.locator('[data-testid$="usersTableBody"]')).toContainText('bob')

    // Generate an invite link
    await page.locator('[data-testid$="nav-invitations"]').click()
    await page.locator('[data-testid$="btnGenerateInvite"]').click()
    await expect(page.locator('[data-testid$="generatedCode"]')).toContainText('INV-')
  })
})
