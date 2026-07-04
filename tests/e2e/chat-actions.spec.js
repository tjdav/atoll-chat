import { test, expect } from './fixtures/base-test'

test.describe('Chat List Item Actions', () => {
  test.beforeEach(async ({ page, loginApp }) => {
    test.setTimeout(120000)
    // Login Alice
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Create Room 1 with Bob
    await page.getByTitle('Create Room').click()
    await page.getByPlaceholder('Search by username...').fill('bob')
    const bobResult = page.locator('.search-result-item').filter({ hasText: 'bob' })
    await expect(bobResult).toBeVisible()
    await bobResult.click()
    await page.getByRole('button', { name: 'Create Room' }).click()
    await expect(page.locator('chat-list-item').filter({ hasText: 'Bob' })).toBeVisible()

    // Send a message in Room 1
    await page.fill('textarea', 'Msg 1')
    await page.keyboard.press('Enter')
    await expect(page.locator('message-timeline')).toContainText('Msg 1')

    // Create Room 2 with Charlie to make Room 1 unselected
    await page.getByTitle('Create Room').click()
    await page.getByPlaceholder('Search by username...').fill('charlie')
    const charlieResult = page.locator('.search-result-item').filter({ hasText: 'charlie' })
    await expect(charlieResult).toBeVisible()
    await charlieResult.click()
    await page.getByRole('button', { name: 'Create Room' }).click()
    await expect(page.locator('chat-list-item').filter({ hasText: 'Charlie' })).toBeVisible()

    // Wait for everything to settle
    await page.waitForTimeout(2000)
  })

  test('should toggle mark as unread', async ({ page }) => {
    const getBobChat = () => page.locator('chat-list-item').filter({ hasText: 'Bob' })

    // Open dropdown for Bob's chat
    await getBobChat().getByLabel('Chat actions').evaluate(el => el.click())

    // Click Mark as unread within Bob's chat dropdown
    await getBobChat().getByTestId('btn-toggle-read').click()

    // Check for success toast
    await expect(page.locator('.toast')).toContainText('Marked as unread')

    // Check for dot
    await expect(getBobChat().getByTestId('unread-dot')).toBeVisible()

    // Click chat item to mark as read
    await getBobChat().locator('.list-item-icon').click()

    // Dot should be gone
    await expect(getBobChat().getByTestId('unread-dot')).toBeHidden()
  })

  test('should toggle mute notifications', async ({ page }) => {
    const getBobChat = () => page.locator('chat-list-item').filter({ hasText: 'Bob' })

    await getBobChat().getByLabel('Chat actions').evaluate(el => el.click())
    await getBobChat().getByTestId('btn-toggle-mute').click()
    await expect(page.locator('.toast')).toContainText('Notifications muted')

    // Wait for re-render and check dropdown label updated
    await page.waitForTimeout(2000)
    await getBobChat().getByLabel('Chat actions').evaluate(el => el.click())
    await expect(getBobChat().getByTestId('btn-toggle-mute')).toContainText('Unmute notifications')

    await getBobChat().getByTestId('btn-toggle-mute').click()
    await expect(page.locator('.toast')).toContainText('Notifications unmuted')
  })

  test('should delete chat after confirmation', async ({ page }) => {
    const getBobChat = () => page.locator('chat-list-item').filter({ hasText: 'Bob' })

    await getBobChat().getByLabel('Chat actions').evaluate(el => el.click())

    page.once('dialog', dialog => dialog.accept())
    await getBobChat().getByTestId('btn-delete-chat').click()

    await expect(page.locator('.toast')).toContainText('Chat deleted')
    await expect(page.locator('chat-list-item').filter({ hasText: 'Bob' })).toHaveCount(0)
  })
})
