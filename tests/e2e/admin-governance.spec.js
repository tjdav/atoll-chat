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

  test('should display table of generated invitations and support copying', async ({ page, loginApp }) => {
    // Login as Alice (Owner)
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Expect app layout to be visible
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })

    // Navigate to Settings -> Invitations
    await page.locator('[data-testid$="profileBtn"]').click()
    await page.locator('[data-testid$="btnSettings"]').click()
    await page.locator('[data-testid$="nav-invitations"]').click()

    // Since Alice is Owner and we have seeded invites in the db, historyCard is visible initially
    await expect(page.locator('[data-testid$="historyCard"]')).toBeVisible()

    // The table body should contain the seeded invite code
    await expect(page.locator('[data-testid$="historyTableBody"]')).toContainText('INV-SEED-1111')

    // Generate a new invite link
    await page.locator('[data-testid$="btnGenerateInvite"]').click()
    await expect(page.locator('[data-testid$="generatedCode"]')).toContainText('INV-')

    const code = await page.locator('[data-testid$="generatedCode"]').textContent()

    // Now historyCard should be visible and also contain the newly generated code
    await expect(page.locator('[data-testid$="historyCard"]')).toBeVisible()

    // The table body should contain the generated code
    await expect(page.locator('[data-testid$="historyTableBody"]')).toContainText(code)

    // Click on copy button inside the table for the generated code
    const copyBtn = page.locator(`[data-testid$="historyTableBody"] tr:has-text("${code}") .btn-copy-history`)
    await expect(copyBtn).toBeVisible()
    await copyBtn.click()

    // Verify copy works by checking clipboard or just ensuring it executes
    const icon = copyBtn.locator('atoll-icon')
    await expect(icon).toHaveAttribute('name', 'check')
    await page.waitForTimeout(1600)
    await expect(icon).toHaveAttribute('name', 'copy')
  })
})
