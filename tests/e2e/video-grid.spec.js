import { test, expect } from './fixtures/base-test.js'

test.describe('Video Grid and Speaker Features', () => {
  let context, page

  test.beforeEach(async ({ browser, loginCustomPage }) => {
    context = await browser.newContext()
    page = await context.newPage()
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
  })

  test.afterEach(async () => {
    await context?.close()
  })

  test('Video grid pinning and dynamic layouts', async () => {
    await test.step('Mock active call room state and participants', async () => {
      await page.evaluate(() => {
        window.__MOCK_CALL_PARTICIPANTS__ = [
          { id: 'user-1', name: 'Jaxon Wooley', username: 'jaxon' },
          { id: 'user-2', name: 'Alexis Lim', username: 'alexis', isSpeaking: true, isMuted: false },
          { id: 'user-3', name: 'Elizabeth Adams', username: 'elizabeth', isMuted: true }
        ]
        window.$stateSet('activeCallRoomId', 'mock-room-123')
        window.$stateSet('callStatus', 'active')
      })
    })

    await test.step('Verify speaker indicators and participant labels', async () => {
      // Alexis Lim has isSpeaking: true -> should have speaking-border-blue
      const alexisTile = page.locator('video-grid .grid-tile').filter({ hasText: 'Alexis Lim' })
      await expect(alexisTile).toHaveClass(/speaking-border-blue/)

      // Alexis Lim should have active-audio wave bars
      await expect(alexisTile.locator('.active-audio')).toBeVisible()

      // Elizabeth Adams has isMuted: true -> should have muted-audio slashed mic
      const elizabethTile = page.locator('video-grid .grid-tile').filter({ hasText: 'Elizabeth Adams' })
      await expect(elizabethTile.locator('.muted-audio')).toBeVisible()

      // Self-view label should say "You"
      const meTile = page.locator('video-grid .grid-tile').filter({ hasText: 'You' })
      await expect(meTile).toBeVisible()
    })

    await test.step('Pin a participant and verify Master-Detail layout transition', async () => {
      const alexisTile = page.locator('video-grid .grid-tile').filter({ hasText: 'Alexis Lim' })
      
      // Click Alexis Lim Pin button
      await alexisTile.locator('.pin-btn').click({ force: true })

      // Container should now have layout-hero class
      await expect(page.locator('video-grid .grid-container')).toHaveClass(/layout-hero/)

      // Alexis Lim should be in the hero-area
      await expect(page.locator('video-grid .hero-area .grid-tile').filter({ hasText: 'Alexis Lim' })).toBeVisible()

      // Others should be in the rail-area
      await expect(page.locator('video-grid .rail-area .grid-tile').filter({ hasText: 'Jaxon Wooley' })).toBeVisible()
    })

    await test.step('Unpin participant and verify restore to standard grid layout', async () => {
      const alexisTile = page.locator('video-grid .grid-tile').filter({ hasText: 'Alexis Lim' })
      
      // Click pin button again to unpin
      await alexisTile.locator('.pin-btn').click({ force: true })

      // Container should return to layout-grid class
      await expect(page.locator('video-grid .grid-container')).toHaveClass(/layout-grid/)
    })
  })

  test('Video grid pagination with 50+ participants', async () => {
    await test.step('Mock 52 active participants', async () => {
      await page.evaluate(() => {
        const list = []
        for (let i = 1; i <= 52; i++) {
          list.push({
            id: `user-${i}`,
            name: `Participant ${i}`,
            username: `user_${i}`
          })
        }
        window.__MOCK_CALL_PARTICIPANTS__ = list
        window.$stateSet('activeCallRoomId', 'mock-room-pagination')
        window.$stateSet('callStatus', 'active')
      })
    })

    await test.step('Open call overlay and verify pagination UI is shown', async () => {
      const paginationControls = page.locator('video-grid .pagination-controls')
      await expect(paginationControls).toBeVisible()
      await expect(paginationControls).toContainText('Page 1 of 2')
    })

    await test.step('Verify 49-tile performance ceiling is strictly enforced', async () => {
      const tilesCount = await page.locator('video-grid .grid-tile').count()
      expect(tilesCount).toBe(49)
    })

    await test.step('Navigate to page 2 and verify next page contents', async () => {
      await page.click('video-grid .pagination-controls button[ref$="btnNextPage"]', { force: true })
      const paginationControls = page.locator('video-grid .pagination-controls')
      await expect(paginationControls).toContainText('Page 2 of 2')

      const tilesCount = await page.locator('video-grid .grid-tile').count()
      // 52 total mocked + 1 local user = 53 items. Page 1 has 49, Page 2 has remaining 4 items.
      expect(tilesCount).toBe(4)
    })
  })

  test('Mobile responsive view scaling & touch adaptations', async () => {
    await test.step('Set viewport to Mobile Dimensions (375x667)', async () => {
      await page.setViewportSize({ width: 375, height: 667 })
    })

    await test.step('Mock group active call state and participants', async () => {
      await page.evaluate(() => {
        window.__MOCK_CALL_PARTICIPANTS__ = [
          { id: 'user-1', name: 'Jaxon Wooley', username: 'jaxon' },
          { id: 'user-2', name: 'Alexis Lim', username: 'alexis', isSpeaking: true, isMuted: false },
          { id: 'user-3', name: 'Elizabeth Adams', username: 'elizabeth' }
        ]
        window.$stateSet('activeCallRoomId', 'mock-room-mobile')
        window.$stateSet('callStatus', 'active')
      })
    })

    await test.step('Open call overlay and verify automatic mobile Hero layout', async () => {
      // Container should have layout-hero class on mobile since participants > 2
      await expect(page.locator('video-grid .grid-container')).toHaveClass(/layout-hero/)

      // Speaking remote (Alexis Lim) should be the hero on mobile automatically
      await expect(page.locator('video-grid .hero-area .grid-tile').filter({ hasText: 'Alexis Lim' })).toBeVisible()
    })
  })
})
