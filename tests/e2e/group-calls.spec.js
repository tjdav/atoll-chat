import { test, expect } from './fixtures/base-test.js'

test.describe.serial('Group Audio and Video Calls', () => {
  let aliceContext, alicePage
  let bobContext, bobPage
  let charlieContext, charliePage

  test.beforeEach(async ({ browser, loginCustomPage }) => {
    await test.step('Create browser contexts with media permissions for Alice, Bob, and Charlie', async () => {
      aliceContext = await browser.newContext()
      alicePage = await aliceContext.newPage()
      bobContext = await browser.newContext()
      bobPage = await bobContext.newPage()
      charlieContext = await browser.newContext()
      charliePage = await charlieContext.newPage()

      // Grant media permissions for headless test environment
      await aliceContext.grantPermissions(['camera', 'microphone'])
      await bobContext.grantPermissions(['camera', 'microphone'])
      await charlieContext.grantPermissions(['camera', 'microphone'])
    })

    await test.step('Login Alice, Bob, and Charlie', async () => {
      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
      await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
      await loginCustomPage(charliePage, 'charlie', 'Password123!', 'VaultPassword123!')
    })

    await test.step('Setup group room for Alice, Bob, and Charlie', async () => {
      const groupRoomName = 'Group Call Dev Team'
      const aliceGroupChat = alicePage.locator('chat-list .app-list-item').filter({ hasText: groupRoomName }).first()
      const roomExists = await aliceGroupChat.isVisible({ timeout: 1000 }).catch(() => false)

      if (roomExists) {
        await aliceGroupChat.click()
      } else {
        await alicePage.locator('[data-testid$="btnCreateRoom"]').click()
        await expect(alicePage.locator('create-room-modal')).toBeVisible()

        // Search and select Bob
        await alicePage.locator('[data-testid$="create-room-modal-0__searchInput"]').fill('bob')
        await alicePage.locator('[data-testid$="search-result-bob"]').click()

        // Search and select Charlie
        await alicePage.locator('[data-testid$="create-room-modal-0__searchInput"]').fill('charlie')
        await alicePage.locator('[data-testid$="search-result-charlie"]').click()

        // Fill group room name
        await alicePage.locator('[data-testid$="create-room-modal-0__roomNameInput"]').fill(groupRoomName)

        // Click Create Room button
        await alicePage.locator('[data-testid$="create-room-modal-0__btnCreate"]').click()
      }

      // Assert Alice has entered group room
      await expect(alicePage.locator('chat-view header h6')).toContainText(groupRoomName, { timeout: 15000 })

      // Assert and open group room for Bob
      const bobGroupChat = bobPage.locator('chat-list atoll-list-item, chat-list .app-list-item').filter({ hasText: groupRoomName }).first()
      await expect(bobGroupChat).toBeVisible({ timeout: 15000 })
      await bobGroupChat.click()
      await expect(bobPage.locator('chat-view header h6')).toContainText(groupRoomName, { timeout: 15000 })

      // Assert and open group room for Charlie
      const charlieGroupChat = charliePage.locator('chat-list atoll-list-item, chat-list .app-list-item').filter({ hasText: groupRoomName }).first()
      await expect(charlieGroupChat).toBeVisible({ timeout: 15000 })
      await charlieGroupChat.click()
      await expect(charliePage.locator('chat-view header h6')).toContainText(groupRoomName, { timeout: 15000 })
    })
  })

  test.afterEach(async () => {
    await aliceContext?.close()
    await bobContext?.close()
    await charlieContext?.close()
  })

  test('Group Audio Call with multi-participant entry and feature verification', async () => {
    await test.step('Alice initiates group audio call', async () => {
      await alicePage.locator('[data-testid$="btnAudioCall"]').click()
    })

    await test.step('Bob and Charlie receive incoming call overlay', async () => {
      const bobIncoming = bobPage.locator('call-overlay .incoming-view')
      const charlieIncoming = charliePage.locator('call-overlay .incoming-view')
      await expect(bobIncoming).toBeVisible({ timeout: 20000 })
      await expect(charlieIncoming).toBeVisible({ timeout: 20000 })
    })

    await test.step('Bob and Charlie accept the group audio call', async () => {
      await bobPage.getByRole('button', { name: 'Accept Call' }).click()
      await charliePage.getByRole('button', { name: 'Accept Call' }).click()
    })

    await test.step('Verify all 3 users enter active call state', async () => {
      await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 15000 })
      await expect(bobPage.locator('call-overlay .active-view')).toBeVisible({ timeout: 15000 })
      await expect(charliePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 15000 })
    })

    const aliceAudioBtn = alicePage.getByRole('button', { name: 'Mute Microphone' })
    const aliceVideoBtn = alicePage.getByRole('button', { name: 'Mute Video' })

    await test.step('Verify initial states (Mic ON, Video OFF)', async () => {
      await expect(aliceAudioBtn).toHaveAttribute('aria-pressed', 'false')
      await expect(aliceVideoBtn).toHaveAttribute('aria-pressed', 'true')
    })

    await test.step('Toggle microphone mute/unmute during group call', async () => {
      await aliceAudioBtn.click()
      await expect(aliceAudioBtn).toHaveAttribute('aria-pressed', 'true')
      await aliceAudioBtn.click()
      await expect(aliceAudioBtn).toHaveAttribute('aria-pressed', 'false')
    })

    await test.step('Alice ends group audio call for all users', async () => {
      await alicePage.locator('call-overlay .active-view [ref$="__btnEndCall"]').click()
      await expect(alicePage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible({ timeout: 10000 })
      await expect(bobPage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible({ timeout: 10000 })
      await expect(charliePage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible({ timeout: 10000 })
    })
  })

  test('Group Video Call with multi-participant video streams, PiP, and messaging', async () => {
    await test.step('Alice initiates group video call', async () => {
      await alicePage.locator('[data-testid$="btnVideoCall"]').click()
    })

    await test.step('Bob and Charlie receive incoming call overlay and accept', async () => {
      await expect(bobPage.locator('call-overlay .incoming-view')).toBeVisible({ timeout: 20000 })
      await expect(charliePage.locator('call-overlay .incoming-view')).toBeVisible({ timeout: 20000 })
      await bobPage.getByRole('button', { name: 'Accept Call' }).click()
      await charliePage.getByRole('button', { name: 'Accept Call' }).click()
    })

    await test.step('Verify active call state for all 3 users', async () => {
      await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 15000 })
      await expect(bobPage.locator('call-overlay .active-view')).toBeVisible({ timeout: 15000 })
      await expect(charliePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 15000 })
    })

    await test.step('Toggle video mute/unmute during active group video call', async () => {
      const aliceVideoBtn = alicePage.getByRole('button', { name: 'Mute Video' })
      await aliceVideoBtn.click()
      await expect(aliceVideoBtn).toHaveAttribute('aria-pressed', 'true')
      await aliceVideoBtn.click()
      await expect(aliceVideoBtn).toHaveAttribute('aria-pressed', 'false')
    })

    await test.step('Verify remote video stream arrival for Alice', async () => {
      await expect.poll(async () => {
        return await alicePage.evaluate(() => {
          const video = document.querySelector('video-grid video.tile-video:not(.d-none)')
          if (!video || !video.srcObject) {
            return false
          }
          const tracks = video.srcObject.getVideoTracks()
          return tracks.length > 0 && tracks[0].readyState === 'live'
        })
      }, {
        timeout: 25000,
        message: 'Remote video stream never arrived for Alice'
      }).toBe(true)
    })

    await test.step('Verify remote video stream arrival for Bob', async () => {
      await expect.poll(async () => {
        return await bobPage.evaluate(() => {
          const video = document.querySelector('video-grid video.tile-video:not(.d-none)')
          if (!video || !video.srcObject) {
            return false
          }
          const tracks = video.srcObject.getVideoTracks()
          return tracks.length > 0 && tracks[0].readyState === 'live'
        })
      }, {
        timeout: 25000,
        message: 'Remote video stream never arrived for Bob'
      }).toBe(true)
    })

    await test.step('Verify remote video stream arrival for Charlie', async () => {
      await expect.poll(async () => {
        return await charliePage.evaluate(() => {
          const video = document.querySelector('video-grid video.tile-video:not(.d-none)')
          if (!video || !video.srcObject) {
            return false
          }
          const tracks = video.srcObject.getVideoTracks()
          return tracks.length > 0 && tracks[0].readyState === 'live'
        })
      }, {
        timeout: 25000,
        message: 'Remote video stream never arrived for Charlie'
      }).toBe(true)
    })

    await test.step('Alice enters Picture-in-Picture mode during group video call', async () => {
      await alicePage.click('[ref$="__btnPip"]')
      await expect(alicePage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible()
      const pipWindow = alicePage.locator('[ref$="__pipWindow"]')
      await expect(pipWindow).toBeVisible()
    })

    await test.step('Alice sends text message in group chat while in PiP mode', async () => {
      const msg = 'Group call active! Message from PiP.'
      await alicePage.fill('chat-input textarea', msg)
      await alicePage.keyboard.press('Enter')
      await expect(alicePage.locator('message-timeline')).toContainText(msg)
      await expect(bobPage.locator('message-timeline')).toContainText(msg)
      await expect(charliePage.locator('message-timeline')).toContainText(msg)
    })

    await test.step('Alice expands back from PiP to full video overlay and ends call', async () => {
      const pipWindow = alicePage.locator('[ref$="__pipWindow"]')
      await pipWindow.hover()
      await alicePage.click('[ref$="__btnExpand"]')
      await expect(alicePage.locator('call-overlay > [ref$="modal"]')).toBeVisible()

      await alicePage.click('[ref$="__btnEndCall"]')
      await expect(alicePage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible({ timeout: 10000 })
      await expect(bobPage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible({ timeout: 10000 })
      await expect(charliePage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible({ timeout: 10000 })
    })
  })
})
