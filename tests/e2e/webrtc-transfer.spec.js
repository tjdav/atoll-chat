import { test, expect } from './fixtures/base-test.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test.describe('P2P WebRTC Media Transfer Fallback', () => {
  test('transfer a media file over WebRTC when exceeding maxServerUploadSizeBytes', async ({ browser, loginCustomPage }) => {

    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    alicePage.on('console', msg => console.log('[BROWSER][alice]', msg.text()))
    await alicePage.addInitScript(() => {
      window.sessionStorage.setItem('atoll_config_maxServerUploadSizeBytes', '1')
    })

    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()
    bobPage.on('console', msg => console.log('[BROWSER][bob]', msg.text()))

    await Promise.all([
      loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!'),
      loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
    ])

    const aliceChat = alicePage.locator('chat-list chat-list-item').filter({ hasText: 'bob' }).first()
    if (!(await aliceChat.isVisible().catch(() => false))) {
      await alicePage.getByTestId('btnCreateRoom').click()
      await alicePage.locator('create-room-modal').getByTestId('searchInput').fill('bob')
      await alicePage.getByTestId('search-result-bob').click()
      await alicePage.getByTestId('btnCreate').click()
    }

    const aliceChatSelect = alicePage.locator('chat-list chat-list-item').filter({ hasText: 'bob' }).first()
    await expect(aliceChatSelect).toBeVisible({ timeout: 30000 })
    await aliceChatSelect.click()

    const bobChat = bobPage.locator('chat-list chat-list-item').filter({ hasText: 'alice' }).first()
    await expect(bobChat).toBeVisible({ timeout: 30000 })
    await bobChat.click()

    const fp = path.resolve('tests/e2e/fixtures/test-files/test.png')
    await alicePage.getByTestId('fileInput').setInputFiles(fp)

    await alicePage.fill('atoll-chat-view textarea', 'Sending heavy image P2P')
    await alicePage.getByTestId('sendButton').click()

    // Bob should see the consent modal appear
    const acceptBtn = bobPage.getByTestId('consent-btn-accept')
    await expect(acceptBtn).toBeVisible({ timeout: 60000 })

    // Accept the file and wait for download
    const downloadPromise = bobPage.waitForEvent('download', { timeout: 60000 })
    await acceptBtn.click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBe('test.webp')

    const hasMediaUpload = await alicePage.evaluate(async () => {
      if (window.$state && window.$state.currentUser) {
        const pbUrl = 'http://localhost:8091'
        const response = await fetch(`${pbUrl}/api/collections/media/records`, {
          headers: {
            'x-test-id': window.__playwright_test_id__
          }
        })
        const data = await response.json()
        return data && data.items && data.items.length > 0
      }
      return false
    })
    expect(hasMediaUpload).toBe(false)

    await aliceContext.close()
    await bobContext.close()
  })

  test('prevent group mesh by intercepting large file upload and prompting reroute', async ({ browser, loginCustomPage }) => {

    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()
    await alicePage.addInitScript(() => {
      window.sessionStorage.setItem('atoll_config_maxServerUploadSizeBytes', '1')
    })

    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()

    await Promise.all([
      loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!'),
      loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
    ])

    // Create a group room with Bob and Charlie
    await alicePage.getByTestId('btnCreateRoom').click()
    await alicePage.locator('create-room-modal').getByTestId('searchInput').fill('bob')
    await alicePage.getByTestId('search-result-bob').click()
    await alicePage.locator('create-room-modal').getByTestId('searchInput').fill('charlie')
    await alicePage.getByTestId('search-result-charlie').click()
    await alicePage.getByTestId('roomNameInput').fill('Project X')
    await alicePage.getByTestId('btnCreate').click()

    const aliceGroupChat = alicePage.locator('chat-list chat-list-item').filter({ hasText: 'Project X' }).first()
    await expect(aliceGroupChat).toBeVisible({ timeout: 30000 })
    await aliceGroupChat.click()

    // Wait for Bob to click the Project X group chat
    const bobGroupChat = bobPage.locator('chat-list chat-list-item').filter({ hasText: 'Project X' }).first()
    await expect(bobGroupChat).toBeVisible({ timeout: 30000 })
    await bobGroupChat.click()

    // Attach heavy file in Group Chat
    const fp = path.resolve('tests/e2e/fixtures/test-files/test.png')
    await alicePage.getByTestId('fileInput').setInputFiles(fp)

    await alicePage.fill('atoll-chat-view textarea', 'Sending heavy image in Group')
    await alicePage.getByTestId('sendButton').click()

    // Alice should see the reroute modal and Bob in the list
    const bobRerouteOption = alicePage.getByTestId('reroute-user-bob')
    await expect(bobRerouteOption).toBeVisible({ timeout: 30000 })
    await bobRerouteOption.click()

    // Bob should see the consent modal appear
    const acceptBtn = bobPage.getByTestId('consent-btn-accept')
    await expect(acceptBtn).toBeVisible({ timeout: 60000 })

    // Accept the file and wait for download
    const downloadPromise = bobPage.waitForEvent('download', { timeout: 60000 })
    await acceptBtn.click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBe('test.webp')

    await aliceContext.close()
    await bobContext.close()
  })
})
