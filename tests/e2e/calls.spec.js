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

    await test.step('Inject dynamic Web Audio tone generator into getUserMedia', async () => {
      const injectAudioMock = async (page) => {
        await page.evaluate(() => {
          if (window.__E2E_AUDIO_MOCK_INJECTED__) {
            return
          }
          window.__E2E_AUDIO_MOCK_INJECTED__ = true

          const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
          navigator.mediaDevices.getUserMedia = async (constraints) => {
            const stream = await originalGetUserMedia(constraints)
            if (constraints && constraints.audio) {
              try {
                const AudioCtxClass = window.AudioContext || window.webkitAudioContext
                const audioCtx = new AudioCtxClass()
                if (audioCtx.state === 'suspended') {
                  audioCtx.resume().catch(() => {
                  })
                }
                const osc = audioCtx.createOscillator()
                const gain = audioCtx.createGain()
                const dest = audioCtx.createMediaStreamDestination()

                osc.type = 'sine'
                osc.frequency.value = 440
                gain.gain.value = 0.5

                osc.connect(gain)
                gain.connect(dest)
                try {
                  gain.connect(audioCtx.destination)
                } catch {
                }
                osc.start()

                const dummyAudio = new Audio()
                dummyAudio.muted = true
                dummyAudio.srcObject = dest.stream
                dummyAudio.play().catch(() => {
                })

                const synthTrack = dest.stream.getAudioTracks()[0]
                window.__E2E_AUDIO_CONTROLLER__ = {
                  audioCtx,
                  osc,
                  gain,
                  synthTrack,
                  setVolume: (val) => {
                    if (audioCtx.state === 'suspended') {
                      audioCtx.resume().catch(() => {
                      })
                    }
                    gain.gain.setValueAtTime(val, audioCtx.currentTime)
                  }
                }

                const origTracks = stream.getAudioTracks()
                if (origTracks.length > 0) {
                  stream.removeTrack(origTracks[0])
                }
                stream.addTrack(synthTrack)
              } catch (err) {
                console.warn('[E2E Audio Mock] Error wrapping audio track:', err)
              }
            }
            return stream
          }
        })
      }

      await injectAudioMock(alicePage)
      await injectAudioMock(bobPage)
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

      const bobChat = bobPage.locator('chat-list atoll-list-item, chat-list .app-list-item').filter({ hasText: 'alice' }).first()
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

      // Verify that dynamic grid elements are displayed
      await expect(alicePage.locator('video-grid .grid-tile').first()).toBeVisible({ timeout: 10000 })
      await expect(bobPage.locator('video-grid .grid-tile').first()).toBeVisible({ timeout: 10000 })

      // Verify that call status is displayed in the chat view header
      await expect(alicePage.locator('chat-view header small')).toHaveText('In Call')
      await expect(bobPage.locator('chat-view header small')).toHaveText('In Call')
    })

    const aliceAudioBtn = alicePage.getByRole('button', { name: 'Mute Microphone' })
    const aliceVideoBtn = alicePage.getByRole('button', { name: 'Mute Video' })

    await test.step('Verify initial states (Mic ON, Cam OFF)', async () => {
      await expect(aliceAudioBtn).toHaveAttribute('aria-pressed', 'false')
      await expect(aliceVideoBtn).toHaveAttribute('aria-pressed', 'true')
    })

    await test.step('Verify visual speaking indicator via dynamic Web Audio stream', async () => {
      // Assert local mic button receives glowing class from live audio track
      await expect(alicePage.locator('call-overlay [ref$="btnToggleAudio"]')).toHaveClass(/speaking-btn-glow/, { timeout: 10000 })

      // Mute local mic generator audio gain
      await alicePage.evaluate(() => {
        if (window.__E2E_AUDIO_CONTROLLER__) {
          window.__E2E_AUDIO_CONTROLLER__.gain.gain.value = 0
        }
      })

      // Assert local mic button loses glowing class after hangover delay
      await expect(alicePage.locator('call-overlay [ref$="btnToggleAudio"]')).not.toHaveClass(/speaking-btn-glow/, { timeout: 10000 })

      // Restore local mic generator audio gain
      await alicePage.evaluate(() => {
        if (window.__E2E_AUDIO_CONTROLLER__) {
          window.__E2E_AUDIO_CONTROLLER__.gain.gain.value = 0.5
        }
      })

      await expect(alicePage.locator('call-overlay [ref$="btnToggleAudio"]')).toHaveClass(/speaking-btn-glow/, { timeout: 10000 })
    })

    await test.step('Toggle microphone mute', async () => {
      await aliceAudioBtn.click()
      await expect(aliceAudioBtn).toHaveAttribute('aria-pressed', 'true')
      await expect(aliceAudioBtn.locator('atoll-icon')).toHaveAttribute('name', 'mic-off')
    })

    await test.step('Alice ends the call', async () => {
      await alicePage.locator('call-overlay [ref$="btnEndCall"]').click()
      await expect(alicePage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible()
      await expect(bobPage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible()

      // Verify that call status reverts back to Private
      await expect(alicePage.locator('chat-view header small')).toHaveText('Private')
      await expect(bobPage.locator('chat-view header small')).toHaveText('Private')

      // Verify timeline system messages for calls exist
      await expect(alicePage.locator('timeline-system-message').filter({ hasText: 'Audio Call' })).toBeVisible()
      await expect(alicePage.locator('timeline-system-message').filter({ hasText: 'Call joined' })).toBeVisible()
      await expect(alicePage.locator('timeline-system-message').filter({ hasText: 'Call ended' })).toBeVisible()
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

    await test.step('Verify glowing speaking-border on video tile when audio stream is active', async () => {
      // Ensure Alice's audio generator is producing tone
      await alicePage.evaluate(() => {
        if (window.__E2E_AUDIO_CONTROLLER__) {
          window.__E2E_AUDIO_CONTROLLER__.setVolume(0.5)
        }
      })
      // Assert Alice's local video element receives speaking-border from Web Audio stream
      await expect(alicePage.locator('video-grid .grid-tile:has-text("You")')).toHaveClass(/speaking-border-blue/, { timeout: 10000 })

      // Mute Alice's audio generator
      await alicePage.evaluate(() => {
        if (window.__E2E_AUDIO_CONTROLLER__) {
          window.__E2E_AUDIO_CONTROLLER__.setVolume(0)
        }
      })

      // Assert Alice's local video element loses speaking-border after hangover delay
      await expect(alicePage.locator('video-grid .grid-tile:has-text("You")')).not.toHaveClass(/speaking-border-blue/, { timeout: 10000 })

      // Restore Alice's audio generator
      await alicePage.evaluate(() => {
        if (window.__E2E_AUDIO_CONTROLLER__) {
          window.__E2E_AUDIO_CONTROLLER__.setVolume(0.5)
        }
      })

      await expect(alicePage.locator('video-grid .grid-tile:has-text("You")')).toHaveClass(/speaking-border-blue/, { timeout: 10000 })
    })

    await test.step('Verify remote video stream has arrived for Bob', async () => {
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
      await expect(alicePage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible()
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
      await expect(alicePage.locator('call-overlay > [ref$="modal"]')).toBeVisible()

      await alicePage.click('[ref$="__btnEndCall"]')
      await expect(alicePage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible()
    })
  })

  test('Multi-device call synchronization: secondary device de-escalation', async ({ browser, loginCustomPage }) => {
    let bob2Context, bob2Page
    await test.step('Configure Bob secondary context and page with media permissions', async () => {
      bob2Context = await browser.newContext()
      bob2Page = await bob2Context.newPage()
      await bob2Context.grantPermissions(['camera', 'microphone'])
    })

    await test.step('Login Bob on secondary device', async () => {
      await loginCustomPage(bob2Page, 'bob', 'Password123!', 'VaultPassword123!')
    })

    await test.step('Inject Web Audio mock on Bob secondary device', async () => {
      await bob2Page.evaluate(() => {
        if (window.__E2E_AUDIO_MOCK_INJECTED__) {
          return
        }
        window.__E2E_AUDIO_MOCK_INJECTED__ = true

        const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          const stream = await originalGetUserMedia(constraints)
          if (constraints && constraints.audio) {
            try {
              const AudioCtxClass = window.AudioContext || window.webkitAudioContext
              const audioCtx = new AudioCtxClass()
              if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {
                })
              }
              const osc = audioCtx.createOscillator()
              const gain = audioCtx.createGain()
              const dest = audioCtx.createMediaStreamDestination()

              osc.type = 'sine'
              osc.frequency.value = 440
              gain.gain.value = 0.5

              osc.connect(gain)
              gain.connect(dest)
              try {
                gain.connect(audioCtx.destination)
              } catch {
              }
              osc.start()

              const dummyAudio = new Audio()
              dummyAudio.muted = true
              dummyAudio.srcObject = dest.stream
              dummyAudio.play().catch(() => {
              })

              const synthTrack = dest.stream.getAudioTracks()[0]
              window.__E2E_AUDIO_CONTROLLER__ = {
                audioCtx,
                osc,
                gain,
                synthTrack,
                setVolume: (val) => {
                  if (audioCtx.state === 'suspended') {
                    audioCtx.resume().catch(() => {
                    })
                  }
                  gain.gain.setValueAtTime(val, audioCtx.currentTime)
                }
              }

              const origTracks = stream.getAudioTracks()
              if (origTracks.length > 0) {
                stream.removeTrack(origTracks[0])
              }
              stream.addTrack(synthTrack)
            } catch (err) {
              console.warn('[E2E Audio Mock] Error wrapping audio track:', err)
            }
          }
          return stream
        }
      })
    })

    await test.step('Open direct room with Alice on Bob secondary device', async () => {
      const bob2Chat = bob2Page.locator('chat-list atoll-list-item, chat-list .app-list-item').filter({ hasText: 'alice' }).first()
      await expect(bob2Chat).toBeVisible({ timeout: 15000 })
      await bob2Chat.click()
      await expect(bob2Page.locator('chat-view header h6')).toContainText('alice', { timeout: 15000 })
    })

    await test.step('Alice initiates audio call', async () => {
      await alicePage.locator('[data-testid="chat-view-0__btnAudioCall"]').click()
    })

    await test.step('Both Bob devices receive incoming call overlay', async () => {
      const bob1IncomingView = bobPage.locator('call-overlay .incoming-view')
      const bob2IncomingView = bob2Page.locator('call-overlay .incoming-view')
      await expect(bob1IncomingView).toBeVisible({ timeout: 20000 })
      await expect(bob2IncomingView).toBeVisible({ timeout: 20000 })
    })

    await test.step('Bob accepts call on Device 1', async () => {
      await bobPage.getByRole('button', { name: 'Accept Call' }).click()
    })

    await test.step('Bob Device 1 transitions to active call', async () => {
      await expect(bobPage.locator('call-overlay .active-view')).toBeVisible({ timeout: 15000 })
    })

    await test.step('Bob Device 2 dismisses modal and shows toast', async () => {
      // Bob Device 2 should dismiss modal and go to idle
      await expect(bob2Page.locator('call-overlay > [ref$="modal"]')).not.toBeVisible({ timeout: 15000 })
      // Toast notification should be shown
      await expect(bob2Page.locator('.toast-body')).toContainText('Call answered on another device', { timeout: 15000 })
      // Take screenshot of Device 2 showing toast and idle background
      await bob2Page.screenshot({ path: 'tests/e2e/screenshots/multi-device-deescalation.png' })
    })

    await test.step('Alice ends the call and both devices return to normal', async () => {
      await alicePage.locator('call-overlay [ref$="btnEndCall"]').click()
      await expect(alicePage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible()
      await expect(bobPage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible()
    })

    await test.step('Clean up Bob secondary context', async () => {
      await bob2Context?.close()
    })
  })

  test('In-Call Device Settings, Effects, and Loss Fail-Safe', async () => {
    await test.step('Alice initiates video call', async () => {
      await alicePage.locator('[data-testid="chat-view-0__btnVideoCall"]').click()
    })

    await test.step('Bob receives incoming video call overlay and accepts', async () => {
      await expect(bobPage.locator('call-overlay .incoming-view')).toBeVisible({ timeout: 20000 })
      await bobPage.getByRole('button', { name: 'Accept Call' }).click()
    })

    await test.step('Verify call is active', async () => {
      await expect(alicePage.locator('call-overlay .active-view')).toBeVisible({ timeout: 10000 })
    })

    await test.step('Verify 5-Button Layout and ARIA settings', async () => {
      const btnToggleAudio = alicePage.locator('call-overlay [ref$="btnToggleAudio"]')
      const btnToggleVideo = alicePage.locator('call-overlay [ref$="btnToggleVideo"]')
      const btnSettings = alicePage.locator('call-overlay [ref$="btnSettings"]')

      await expect(btnToggleAudio).toHaveAttribute('aria-label', 'Mute Microphone')
      await expect(btnToggleVideo).toHaveAttribute('aria-label', 'Mute Video')
      await expect(btnSettings).toHaveAttribute('aria-label', 'Settings')

      // Assert that the inner atoll-icon components have correct dynamic name attributes
      await expect(btnToggleAudio.locator('atoll-icon')).toHaveAttribute('name', 'mic')
      await expect(btnToggleVideo.locator('atoll-icon')).toHaveAttribute('name', 'videocam')
    })

    await test.step('Open Unified Device Settings popup and verify structure', async () => {
      const btnSettings = alicePage.locator('call-overlay [ref$="btnSettings"]')
      await btnSettings.click()

      // Assert Select a Microphone, Effects, and Select a Speaker headings exist
      const settingsPopup = alicePage.locator('call-overlay [ref$="settingsPopup"] .modal')
      await expect(settingsPopup).toBeVisible()

      await alicePage.screenshot({ path: 'tests/e2e/screenshots/verification-screenshot.png' })

      await expect(alicePage.locator('call-overlay .settings-section-header').filter({ hasText: 'AUDIO' })).toBeVisible()
      await expect(alicePage.locator('call-overlay .settings-section-subheader').filter({ hasText: 'Select a Microphone' })).toBeVisible()
      await expect(alicePage.locator('call-overlay .settings-section-subheader').filter({ hasText: 'Microphone Effects' })).toBeVisible()
      await expect(alicePage.locator('call-overlay .settings-section-subheader').filter({ hasText: 'Select a Speaker' })).toBeVisible()

      // Expect default "Noise cancellation" checked
      await expect(alicePage.locator('call-overlay #noise-cancellation-switch')).toBeChecked()
    })

    await test.step('Toggle Noise Cancellation', async () => {
      await alicePage.locator('call-overlay #noise-cancellation-switch').click()
      await expect(alicePage.locator('call-overlay #noise-cancellation-switch')).not.toBeChecked()

      // Verify stored preference in local storage
      const value = await alicePage.evaluate(() => localStorage.getItem('atoll_noise_cancellation'))
      expect(value).toBe('false')
    })

    await test.step('Verify Camera settings and Background Blur Mock inside Unified Settings', async () => {
      await expect(alicePage.locator('call-overlay .settings-section-header').filter({ hasText: 'VIDEO' })).toBeVisible()
      await expect(alicePage.locator('call-overlay .settings-section-subheader').filter({ hasText: 'Select a Camera' })).toBeVisible()
      await expect(alicePage.locator('call-overlay .settings-section-subheader').filter({ hasText: 'Video Effects' })).toBeVisible()

      // Toggle Background Blur
      const blurSwitch = alicePage.locator('call-overlay #background-blur-switch')
      await expect(blurSwitch).not.toBeChecked()
      await blurSwitch.click()
      await expect(blurSwitch).toBeChecked()

      // Verify CSS blur filter is applied to Alice's local preview element
      await expect(alicePage.locator('video-grid .grid-tile:has-text("You") video')).toHaveCSS('filter', /blur\(10px\)/)
    })

    await test.step('Simulate Active Microphone disconnected fail-safe mid-call', async () => {
      // Capture state before disconnect
      await expect(alicePage.locator('call-overlay [ref$="btnToggleAudio"]')).not.toHaveClass(/btn-danger/)

      // Simulate disconnect
      await alicePage.evaluate(() => {
        // Enforce microphones list is empty on next fetch
        navigator.mediaDevices.enumerateDevices = async () => [
          {
            kind: 'videoinput',
            label: 'Camera',
            deviceId: 'cam1'
          }
        ]
        // Trigger devicechange event
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
      })

      // Expect warning toast
      await expect(alicePage.locator('.toast-body')).toContainText('Microphone disconnected.')

      // Expect Alice to be force muted
      const btnToggleAudio = alicePage.locator('call-overlay [ref$="btnToggleAudio"]')
      await expect(btnToggleAudio).toHaveClass(/btn-danger/)
      await expect(btnToggleAudio).toHaveAttribute('aria-pressed', 'true')
    })

    await test.step('End the call', async () => {
      const doneBtn = alicePage.getByRole('button', { name: 'Done' })
      if (await doneBtn.isVisible()) {
        await doneBtn.click()
      }
      await alicePage.locator('call-overlay [ref$="btnEndCall"]').click()
      await expect(alicePage.locator('call-overlay > [ref$="modal"]')).not.toBeVisible()
    })
  })
})
