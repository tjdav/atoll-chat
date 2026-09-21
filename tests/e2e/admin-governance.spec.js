import { test, expect } from './fixtures/base-test.js'

test.describe('Super-User Administration & Zero-Knowledge Delegated Invite System', () => {

  test('should register first user as owner and subsequent users as standard, then verify admin endpoints', async ({ page, loginApp }) => {
    // Login as Alice (who is promoted to Owner in the DB)
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Expect app layout to be visible
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })

    // Navigate to Settings page
    await page.getByTestId('profileBtn').click()
    await page.getByTestId('btnSettings').click()

    // Verify ADMINISTRATION navbar section exists for Owner (Alice)
    await expect(page.getByTestId('nav-admin-overview')).toBeVisible()
    await expect(page.getByTestId('nav-admin-trust')).toBeVisible()
    await expect(page.getByTestId('nav-admin-requests')).toBeVisible()

    // Go to overview and verify statistics
    await page.getByTestId('nav-admin-overview').click()
    await expect(page.getByTestId('statTotalUsers')).not.toContainText('--')

    // Change delegation mode and save
    await page.getByTestId('modeStrict').click()
    await page.getByTestId('btnSaveGovernance').click()
    await expect(page.getByTestId('saveSuccessAlert')).toBeVisible()

    // Restore to delegated mode and save
    await page.getByTestId('modeDelegated').click()
    await page.getByTestId('btnSaveGovernance').click()
    await expect(page.getByTestId('saveSuccessAlert')).toBeVisible()

    // Check trust matrix
    await page.getByTestId('nav-admin-trust').click()
    await expect(page.getByTestId('usersTableBody')).toContainText('bob')

    // Generate an invite link
    await page.getByTestId('nav-invitations').click()
    await page.getByTestId('btnGenerateInvite').click()
    await expect(page.getByTestId('invitationsList')).toContainText('INV-')
  })

  test('should display list of generated invitations and support copying', async ({ page, loginApp }) => {
    // Login as Alice (Owner)
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Expect app layout to be visible
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })

    // Navigate to Settings -> Invitations
    await page.getByTestId('profileBtn').click()
    await page.getByTestId('btnSettings').click()
    await page.getByTestId('nav-invitations').click()

    // Since Alice is Owner and we have seeded invites in the db, historyCard is visible initially
    await expect(page.getByTestId('historyCard')).toBeVisible()

    // The invitations list should contain the seeded invite code
    await expect(page.getByTestId('invitationsList')).toContainText('INV-SEED-1111')

    // Generate a new invite link
    await page.getByTestId('btnGenerateInvite').click()

    // Now historyCard should be visible and contain the newly generated code item at top
    await expect(page.getByTestId('historyCard')).toBeVisible()
    const firstItem = page.getByTestId('invitationsList').locator('atoll-list-item').first()
    await expect(firstItem).toContainText('INV-')

    // Click on Copy Code button inside the top item
    const copyCodeBtn = firstItem.locator('.btn-copy-code')
    await expect(copyCodeBtn).toBeVisible()
    await copyCodeBtn.click()

    // Verify copy works by checking icon feedback
    const codeIcon = copyCodeBtn.locator('atoll-icon')
    await expect(codeIcon).toHaveAttribute('name', 'check')
    await page.waitForTimeout(1600)
    await expect(codeIcon).toHaveAttribute('name', 'copy')

    // Click on Copy Link button inside the top item
    const copyLinkBtn = firstItem.locator('.btn-copy-link')
    await expect(copyLinkBtn).toBeVisible()
    await copyLinkBtn.click()

    // Verify copy link feedback
    const linkIcon = copyLinkBtn.locator('atoll-icon')
    await expect(linkIcon).toHaveAttribute('name', 'check')
    await expect(copyLinkBtn.locator('.btn-copy-link-text')).toHaveText('Copied!')
  })
})
