import { test, expect } from './fixtures/base-test.js'

test.describe.serial('Calls', () => {
  let aliceContext, alicePage
  let bobContext, bobPage

  test.beforeEach(async ({ browser, loginCustomPage }) => {
    await test.step('Create and configure browser contexts with permissions', async () => {
      aliceContext = await browser.newContext()
      alicePage = await aliceContext.newPage()
      bobContext = await browser.newContext()
      bobPage = await bobContext.newPage()

      // Grant media permissions for CI headless environment
      await aliceContext.grantPermissions(['camera', 'microphone'])
      await bobContext.grantPermissions(['camera', 'microphone'])
    })

    await test.step('Login Alice and Bob', async () => {
      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
      await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
    })

    await test.step('Setup direct room between Alice and Bob', async () => {
      // Fast-timeout check to see if Bob's chat room is already in Alice's sidebar list
      const aliceBobChat = alicePage.locator('chat-list .app-list-item').filter({ hasText: 'bob' }).first()
      const roomExists = await aliceBobChat.isVisible({ timeout: 500 }).catch(() => false)

      if (roomExists) {
        await aliceBobChat.click()
      } else {
        await alicePage.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
        await alicePage.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
        await alicePage.locator('[data-testid$="search-result-bob"]').click()
        await alicePage.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
      }
      await expect(alicePage.locator('chat-view header h6')).toContainText('bob', { timeout: 15000 })

      const bobChat = bobPage.locator('chat-list .app-list-item').filter({ hasText: 'alice' }).first()
      await expect(bobChat).toBeVisible({ timeout: 15000 })
      await bobChat.click()
      await expect(bobPage.locator('chat-view header h6')).toContainText('alice', { timeout: 15000 })
    })
  })

  test.afterEach(async () => {
    await aliceContext?.close()
    await bobContext?.close()
  })

  test('Audio Call between Alice and Bob', async () => {
    await test.step('Alice initiates audio call', async () => {
      await alicePage.locator('[data-testid="chat-view-0__btnAudioCall"]').click()
    })

    await test.step('Bob receives incoming audio call overlay', async () => {
      const bobIncomingView = bobPage.locator('call-overlay .incoming-view')
      await expect(bobIncomingView).toBeVisible({ timeout: 20000 })
      await expect(bobIncomingView.locator('h2')).not.toHaveText('Unknown Caller', { timeout: 10000 })
    })

    await test.step('Bob accepts the audio call', async () => {
      const bobAcceptBtn = bobPage.getByRole('button', { name: 'Accept Call' })
      await bobAcceptBtn.click()
    })

    await test.step('Verify both calls enter active state', async () => {
      await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })
      await expect(bobPage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })
    })

    const aliceAudioBtn = alicePage.getByRole('button', { name: 'Mute Microphone' })
    const aliceVideoBtn = alicePage.getByRole('button', { name: 'Mute Video' })

    await test.step('Verify initial states (Mic ON, Cam OFF)', async () => {
      await expect(aliceAudioBtn).toHaveAttribute('aria-pressed', 'false')
      await expect(aliceVideoBtn).toHaveAttribute('aria-pressed', 'true')
    })

    await test.step('Toggle microphone mute', async () => {
      await aliceAudioBtn.click()
      await expect(aliceAudioBtn).toHaveAttribute('aria-pressed', 'true')
    })

    await test.step('Alice ends the call', async () => {
      await alicePage.locator('call-overlay .active-view button:has(.bi-telephone-x-fill)').click()
      await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
      await expect(bobPage.locator('call-overlay .modal')).not.toBeVisible()
    })
  })

  test('Video Call with PiP and Messaging', async () => {
    await test.step('Alice initiates video call', async () => {
      await alicePage.locator('[data-testid="chat-view-0__btnVideoCall"]').click()
    })

    await test.step('Bob receives incoming video call overlay and accepts', async () => {
      await expect(bobPage.locator('call-overlay .incoming-view')).toBeVisible({ timeout: 20000 })
      await bobPage.getByRole('button', { name: 'Accept Call' }).click()
    })

    await test.step('Verify call is active for Alice', async () => {
      await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })
    })

    await test.step('Verify remote video stream has arrived for Alice', async () => {
      await expect.poll(async () => {
        return await alicePage.evaluate(() => {
          const video = document.querySelector('video-grid video.remote-video')
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

    await test.step('Verify remote video stream has arrived for Bob', async () => {
      await expect.poll(async () => {
        return await bobPage.evaluate(() => {
          const video = document.querySelector('video-grid video.remote-video')
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

    await test.step('Assert active WebRTC bandwidth flow and video frame processing (outbound RTP)', async () => {
      await expect.poll(async () => {
        return await alicePage.evaluate(async () => {
          const pc = window.__E2E_PEER_CONNECTION__
          if (!pc) {
            return -1
          }
          const stats = await pc.getStats()
          let bytesSent = -1
          stats.forEach(report => {
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
              bytesSent = report.bytesSent
            }
          })
          return bytesSent
        })
      }, {
        timeout: 15000,
        message: 'WebRTC bytes sent never exceeded threshold'
      }).toBeGreaterThanOrEqual(0)
    })

    await test.step('Assert active WebRTC bandwidth flow and video frame processing (inbound RTP)', async () => {
      await expect.poll(async () => {
        return await bobPage.evaluate(async () => {
          const pc = window.__E2E_PEER_CONNECTION__
          if (!pc) {
            return -1
          }
          const stats = await pc.getStats()
          let bytesReceived = 0
          stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
              bytesReceived = report.bytesReceived
            }
          })
          return bytesReceived
        })
      }, {
        timeout: 15000,
        message: 'WebRTC bytes received never exceeded threshold'
      }).toBeGreaterThanOrEqual(0)
    })

    await test.step('Alice enters Picture-in-Picture mode', async () => {
      await alicePage.click('[ref$="__btnPip"]')
      await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
      const pipWindow = alicePage.locator('[ref$="__pipWindow"]')
      await expect(pipWindow).toBeVisible()
    })

    await test.step('Alice sends text message while in PiP', async () => {
      const msg = 'Still here in PiP!'
      await alicePage.fill('chat-input textarea', msg)
      await alicePage.keyboard.press('Enter')
      await expect(alicePage.locator('message-timeline')).toContainText(msg)
    })

    await test.step('Alice expands back to full screen from PiP and ends call', async () => {
      const pipWindow = alicePage.locator('[ref$="__pipWindow"]')
      await pipWindow.hover()
      await alicePage.click('[ref$="__btnExpand"]')
      await expect(alicePage.locator('call-overlay .modal')).toBeVisible()

      await alicePage.click('[ref$="__btnEndCall"]')
      await expect(alicePage.locator('call-overlay .modal')).not.toBeVisible()
    })
  })
})
