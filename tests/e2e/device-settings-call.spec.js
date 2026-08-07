import { test, expect } from './fixtures/base-test.js'

test.describe.serial('Call Device Settings', () => {
  let aliceContext, alicePage
  let bobContext, bobPage

  test.beforeEach(async ({ browser, loginCustomPage }) => {
    await test.step('Create and configure browser contexts with permissions', async () => {
      aliceContext = await browser.newContext()
      alicePage = await aliceContext.newPage()
      bobContext = await browser.newContext()
      bobPage = await bobContext.newPage()

      // Grant media permissions
      await aliceContext.grantPermissions(['camera', 'microphone'])
      await bobContext.grantPermissions(['camera', 'microphone'])
    })

    await test.step('Login Alice and Bob', async () => {
      await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
      await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')
    })

    await test.step('Mock media devices with multiple virtual hardware devices', async () => {
      const injectMockDevices = async (page, withSpeakerSelection = true) => {
        await page.evaluate((withSpeaker) => {
          // Define standard mock device list
          const mockDevices = [
            {
              kind: 'audioinput',
              label: 'Mock Microphone 1',
              deviceId: 'mic-1',
              groupId: 'group-1'
            },
            {
              kind: 'audioinput',
              label: 'Mock Microphone 2',
              deviceId: 'mic-2',
              groupId: 'group-2'
            },
            {
              kind: 'videoinput',
              label: 'Mock Camera 1',
              deviceId: 'cam-1',
              groupId: 'group-1'
            },
            {
              kind: 'videoinput',
              label: 'Mock Camera 2',
              deviceId: 'cam-2',
              groupId: 'group-2'
            }
          ]

          if (withSpeaker) {
            mockDevices.push(
              {
                kind: 'audiooutput',
                label: 'Mock Speaker 1',
                deviceId: 'speaker-1',
                groupId: 'group-1'
              },
              {
                kind: 'audiooutput',
                label: 'Mock Speaker 2',
                deviceId: 'speaker-2',
                groupId: 'group-2'
              }
            )
          }

          // Mock enumerateDevices
          navigator.mediaDevices.enumerateDevices = async () => mockDevices

          // Track getUserMedia constraint parameters and mock replaceTrack trigger
          window.__E2E_GUM_CALLS__ = []
          const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
          navigator.mediaDevices.getUserMedia = async (constraints) => {
            window.__E2E_GUM_CALLS__.push(constraints)

            // Clean/bypass exact deviceId constraints to avoid OverconstrainedError in headless browser
            const cleanConstraints = JSON.parse(JSON.stringify(constraints))
            if (cleanConstraints.audio && typeof cleanConstraints.audio === 'object') {
              delete cleanConstraints.audio.deviceId
            }
            if (cleanConstraints.video && typeof cleanConstraints.video === 'object') {
              delete cleanConstraints.video.deviceId
            }

            try {
              return await originalGetUserMedia(cleanConstraints)
            } catch (err) {
              console.warn('[E2E getUserMedia Mock] original GUM failed, returning mock stream:', err)
              const mockStream = new MediaStream()
              if (constraints.audio) {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
                const osc = audioCtx.createOscillator()
                const dest = audioCtx.createMediaStreamDestination()
                osc.connect(dest)
                osc.start()
                const track = dest.stream.getAudioTracks()[0]
                mockStream.addTrack(track)
              }
              if (constraints.video) {
                const canvas = document.createElement('canvas')
                canvas.width = 640
                canvas.height = 480
                const ctx = canvas.getContext('2d')
                ctx.fillStyle = 'blue'
                ctx.fillRect(0, 0, 640, 480)
                const stream = canvas.captureStream(30)
                const track = stream.getVideoTracks()[0]
                mockStream.addTrack(track)
              }
              return mockStream
            }
          }

          // Support mock WebRTC PeerConnection track swap verification
          window.__E2E_TRACK_SWAPS__ = []
          const originalPC = window.RTCPeerConnection
          if (originalPC) {
            window.RTCPeerConnection = function (...args) {
              const pc = new originalPC(...args)
              const originalGetSenders = pc.getSenders.bind(pc)
              pc.getSenders = () => {
                const senders = originalGetSenders()
                senders.forEach(sender => {
                  if (!sender.__WRAPPED__) {
                    sender.__WRAPPED__ = true
                    const originalReplaceTrack = sender.replaceTrack ? sender.replaceTrack.bind(sender) : null
                    sender.replaceTrack = async (newTrack) => {
                      window.__E2E_TRACK_SWAPS__.push({
                        kind: newTrack ? newTrack.kind : 'unknown',
                        id: newTrack ? newTrack.id : null,
                        label: newTrack ? newTrack.label : null,
                        enabled: newTrack ? newTrack.enabled : null
                      })
                      if (originalReplaceTrack) {
                        return originalReplaceTrack(newTrack)
                      }
                      return Promise.resolve()
                    }
                  }
                })
                return senders
              }
              window.__E2E_PEER_CONNECTION__ = pc
              return pc
            }
          }
        }, withSpeakerSelection)
      }

      await injectMockDevices(alicePage, true)
      await injectMockDevices(bobPage, true)
    })

    await test.step('Setup direct room between Alice and Bob', async () => {
      const aliceBobChat = alicePage.locator('chat-list chat-list-item').filter({ hasText: 'bob' }).first()
      const roomExists = await aliceBobChat.isVisible({ timeout: 500 }).catch(() => false)

      if (roomExists) {
        await aliceBobChat.click()
      } else {
        await alicePage.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
        await alicePage.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
        await alicePage.locator('[data-testid$="search-result-bob"]').click()
        await alicePage.locator('[data-testid="create-room-modal-0__btnCreate"]').click()
      }
      await expect(alicePage.locator('atoll-chat-view header h6')).toContainText('bob', { timeout: 15000 })

      const bobChat = bobPage.locator('chat-list chat-list-item').filter({ hasText: 'alice' }).first()
      await expect(bobChat).toBeVisible({ timeout: 15000 })
      await bobChat.click()
      await expect(bobPage.locator('atoll-chat-view header h6')).toContainText('alice', { timeout: 15000 })
    })

    await test.step('Configure initial localStorage device preferences', async () => {
      await alicePage.evaluate(() => {
        localStorage.setItem('atoll_active_microphone', 'mic-1')
        localStorage.setItem('atoll_active_camera', 'cam-1')
        localStorage.setItem('atoll_active_speaker', 'speaker-1')
        localStorage.setItem('atoll_noise_cancellation', 'true')
        localStorage.setItem('atoll_background_blur', 'false')
      })
    })
  })

  test.afterEach(async () => {
    await aliceContext?.close()
    await bobContext?.close()
  })

  test('Device settings structure and hot-swapping during an active Audio Call', async () => {
    await test.step('Alice initiates and Bob accepts audio call', async () => {
      await alicePage.locator('[data-testid$="btnAudioCall"]').click()
      const bobAcceptBtn = bobPage.getByRole('button', { name: 'Accept Call' })
      await expect(bobAcceptBtn).toBeVisible({ timeout: 20000 })
      await bobAcceptBtn.click()

      await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })
      await expect(bobPage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })
    })

    await test.step('Alice opens unified Device Settings popup', async () => {
      const btnSettings = alicePage.locator('call-overlay [ref$="btnSettings"] button')
      await btnSettings.click()

      const settingsPopup = alicePage.locator('call-overlay [ref$="settingsPopup"] .modal')
      await expect(settingsPopup).toBeVisible()
      await alicePage.screenshot({ path: 'tests/e2e/screenshots/device-settings-open.png' })
    })

    await test.step('Verify initial hardware and effect states are rendered correctly', async () => {
      // Audio headings
      await expect(alicePage.locator('call-overlay .settings-section-header').filter({ hasText: 'AUDIO' })).toBeVisible()
      await expect(alicePage.locator('call-overlay .settings-section-subheader').filter({ hasText: 'Select a Microphone' })).toBeVisible()
      await expect(alicePage.locator('call-overlay .settings-section-subheader').filter({ hasText: 'Microphone Effects' })).toBeVisible()
      await expect(alicePage.locator('call-overlay .settings-section-subheader').filter({ hasText: 'Select a Speaker' })).toBeVisible()

      // Expected NC default
      await expect(alicePage.locator('call-overlay #noise-cancellation-switch')).toBeChecked()

      // Video headings
      await expect(alicePage.locator('call-overlay .settings-section-header').filter({ hasText: 'VIDEO' })).toBeVisible()
      await expect(alicePage.locator('call-overlay .settings-section-subheader').filter({ hasText: 'Select a Camera' })).toBeVisible()
      await expect(alicePage.locator('call-overlay .settings-section-subheader').filter({ hasText: 'Video Effects' })).toBeVisible()

      // Expected Background Blur default
      await expect(alicePage.locator('call-overlay #background-blur-switch')).not.toBeChecked()
    })

    await test.step('Switch microphone via dropdown and verify hot-swapping', async () => {
      const micSelect = alicePage.locator('call-overlay [ref$="micSelect"]')
      const toggleBtn = micSelect.locator('button.atoll-select-toggle')

      await toggleBtn.click()

      // Choose secondary mic
      const secondaryMicOption = micSelect.locator('.dropdown-item[data-value="mic-2"]')
      await expect(secondaryMicOption).toBeVisible()
      await secondaryMicOption.click({ force: true })

      // Check localStorage update
      const storedMicId = await alicePage.evaluate(() => localStorage.getItem('atoll_active_microphone'))
      expect(storedMicId).toBe('mic-2')

      // Verify Track Swap was triggered in WebRTC PeerConnection
      await expect.poll(async () => {
        const trackSwaps = await alicePage.evaluate(() => window.__E2E_TRACK_SWAPS__)
        return trackSwaps.find(swap => swap.kind === 'audio')
      }, { timeout: 10000 }).toBeDefined()
    })

    await test.step('Switch speaker via dropdown and verify setSinkId application', async () => {
      // Verify mock track swaps for speaker/setSinkId if applicable
      const speakerSelect = alicePage.locator('call-overlay [ref$="speakerSelect"]')
      const toggleBtn = speakerSelect.locator('button.atoll-select-toggle')
      await toggleBtn.click()

      const secondarySpeakerOption = speakerSelect.locator('.dropdown-item[data-value="speaker-2"]')
      await expect(secondarySpeakerOption).toBeVisible()
      await secondarySpeakerOption.click({ force: true })

      const storedSpeakerId = await alicePage.evaluate(() => localStorage.getItem('atoll_active_speaker'))
      expect(storedSpeakerId).toBe('speaker-2')
    })

    await test.step('Click Done to close settings and verify settings persist', async () => {
      const doneBtn = alicePage.getByRole('button', { name: 'Done' })
      await doneBtn.click({ force: true })

      const settingsPopup = alicePage.locator('call-overlay [ref$="settingsPopup"] .modal')
      await expect(settingsPopup).not.toBeVisible()

      // Ensure selections survived the close/reopen
      await alicePage.locator('call-overlay [ref$="btnSettings"] button').click()
      await expect(settingsPopup).toBeVisible()

      const micSelectVal = await alicePage.locator('call-overlay [ref$="micSelect"]').evaluate(el => el.value)
      expect(micSelectVal).toBe('mic-2')

      const speakerSelectVal = await alicePage.locator('call-overlay [ref$="speakerSelect"]').evaluate(el => el.value)
      expect(speakerSelectVal).toBe('speaker-2')

      // Close settings modal
      await doneBtn.click({ force: true })
      await expect(settingsPopup).not.toBeVisible()
      await alicePage.waitForTimeout(500)
    })

    await test.step('End the call', async () => {
      await alicePage.locator('call-overlay [ref$="btnEndCall"] button').click({ force: true })
      await expect(alicePage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible()
    })
  })

  test('Revert Rollback behavior on Cancel or backdrop click', async () => {
    await test.step('Alice initiates and Bob accepts audio call', async () => {
      await alicePage.locator('[data-testid$="btnAudioCall"]').click()
      const bobAcceptBtn = bobPage.getByRole('button', { name: 'Accept Call' })
      await expect(bobAcceptBtn).toBeVisible({ timeout: 20000 })
      await bobAcceptBtn.click()

      await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })
    })

    await test.step('Alice opens settings, makes changes, and cancels', async () => {
      const btnSettings = alicePage.locator('call-overlay [ref$="btnSettings"] button')
      await btnSettings.click()

      // Change microphone, toggle NC, toggle Background blur
      const micSelect = alicePage.locator('call-overlay [ref$="micSelect"]')
      const toggleBtn = micSelect.locator('button.atoll-select-toggle')
      await toggleBtn.click()

      const secondaryMicOption = micSelect.locator('.dropdown-item[data-value="mic-2"]')
      await expect(secondaryMicOption).toBeVisible()
      await secondaryMicOption.click({ force: true })

      const ncSwitch = alicePage.locator('call-overlay #noise-cancellation-switch')
      // turn off noise cancellation
      await ncSwitch.click({ force: true })

      const blurSwitch = alicePage.locator('call-overlay #background-blur-switch')
      // turn on background blur
      await blurSwitch.click({ force: true })

      // Click Cancel button inside settings popup to trigger rollback
      const cancelBtn = alicePage.getByRole('button', { name: 'Cancel' })
      await cancelBtn.click({ force: true })

      // Wait for settings popup to be fully hidden so rollback executes
      const settingsPopup = alicePage.locator('call-overlay [ref$="settingsPopup"] .modal')
      await expect(settingsPopup).not.toBeVisible()

      // Verify that values were reverted to snapshot states
      const storedMicId = await alicePage.evaluate(() => localStorage.getItem('atoll_active_microphone'))
      const storedNC = await alicePage.evaluate(() => localStorage.getItem('atoll_noise_cancellation'))
      const storedBlur = await alicePage.evaluate(() => localStorage.getItem('atoll_background_blur'))

      expect(storedMicId).toBe('mic-1')
      expect(storedNC).toBe('true')
      expect(storedBlur).toBe('false')
    })

    await test.step('End the call', async () => {
      await alicePage.locator('call-overlay [ref$="btnEndCall"] button').click({ force: true })
    })
  })

  test('Video Call device settings and effects', async () => {
    await test.step('Alice initiates and Bob accepts video call', async () => {
      await alicePage.locator('[data-testid$="btnVideoCall"]').click()
      const bobAcceptBtn = bobPage.getByRole('button', { name: 'Accept Call' })
      await expect(bobAcceptBtn).toBeVisible({ timeout: 20000 })
      await bobAcceptBtn.click()

      await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })
    })

    await test.step('Alice opens unified Device Settings popup', async () => {
      const btnSettings = alicePage.locator('call-overlay [ref$="btnSettings"] button')
      await btnSettings.click()

      const settingsPopup = alicePage.locator('call-overlay [ref$="settingsPopup"] .modal')
      await expect(settingsPopup).toBeVisible()
    })

    await test.step('Switch camera via dropdown and verify hot-swapping', async () => {
      const camSelect = alicePage.locator('call-overlay [ref$="camSelect"]')
      const toggleBtn = camSelect.locator('button.atoll-select-toggle')
      await toggleBtn.click()

      // Choose secondary camera
      const secondaryCamOption = camSelect.locator('.dropdown-item[data-value="cam-2"]')
      await expect(secondaryCamOption).toBeVisible()
      await secondaryCamOption.click({ force: true })

      // Ensure camera dropdown menu is closed to prevent overlapping issues
      await expect(camSelect.locator('.atoll-select-menu')).not.toBeVisible()

      // Check localStorage update
      const storedCamId = await alicePage.evaluate(() => localStorage.getItem('atoll_active_camera'))
      expect(storedCamId).toBe('cam-2')

      // Verify Track Swap was triggered in WebRTC PeerConnection for video
      await expect.poll(async () => {
        const trackSwaps = await alicePage.evaluate(() => window.__E2E_TRACK_SWAPS__)
        return trackSwaps.find(swap => swap.kind === 'video')
      }, { timeout: 10000 }).toBeDefined()
    })

    await test.step('Toggle background blur and verify CSS filter application', async () => {
      const blurSwitch = alicePage.locator('call-overlay #background-blur-switch')
      await expect(blurSwitch).not.toBeChecked()
      await blurSwitch.click()
      await expect(blurSwitch).toBeChecked()

      // Verify CSS blur filter is applied to Alice's local preview element
      await expect(alicePage.locator('video-grid .grid-tile:has-text("You") video')).toHaveCSS('filter', /blur\(10px\)/)
    })

    await test.step('Close settings and end call', async () => {
      const doneBtn = alicePage.getByRole('button', { name: 'Done' })
      await doneBtn.click({ force: true })

      await alicePage.locator('call-overlay [ref$="btnEndCall"] button').click({ force: true })
    })
  })

  test('Speaker Selection Fallback on non-supported browsers', async () => {
    await test.step('De-authorize setSinkId to simulate non-supported browser', async () => {
      await alicePage.evaluate(() => {
        delete HTMLMediaElement.prototype.setSinkId
      })
    })

    await test.step('Alice initiates and Bob accepts call', async () => {
      await alicePage.locator('[data-testid$="btnAudioCall"]').click()
      const bobAcceptBtn = bobPage.getByRole('button', { name: 'Accept Call' })
      await expect(bobAcceptBtn).toBeVisible({ timeout: 20000 })
      await bobAcceptBtn.click()

      await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })
    })

    await test.step('Open settings and verify speaker select is replaced by fallback text box', async () => {
      const btnSettings = alicePage.locator('call-overlay [ref$="btnSettings"] button')
      await btnSettings.click()

      const speakerSelect = alicePage.locator('call-overlay [ref$="speakerSelect"]')
      await expect(speakerSelect).toBeHidden()

      const fallbackBox = alicePage.locator('call-overlay [ref$="speakerFallback"]')
      await expect(fallbackBox).toBeVisible()
      await expect(fallbackBox).toContainText('Playing via system speaker')
    })

    await test.step('End the call', async () => {
      const doneBtn = alicePage.getByRole('button', { name: 'Done' })
      await doneBtn.click({ force: true })
      await alicePage.locator('call-overlay [ref$="btnEndCall"] button').click({ force: true })
    })
  })
})
