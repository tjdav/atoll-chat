/**
 * Manages audio/video hardware enumeration, hot-swapping, device loss fail-safes,
 * and media effect settings (noise cancellation, background blur).
 */

/**
 * Factory function to create and manage the Call Device Manager.
 * Handles audio/video hardware enumeration, hot-swapping, device loss fail-safes,
 * and media effect settings (noise cancellation, background blur).
 *
 * @param {Object} options - Configuration and context properties.
 * @param {Object} options.state - Component local reactive state.
 * @param {Function} options.refs - Component template reference locator function.
 * @param {Object} options.globalStore - Global application state store container.
 * @param {Object} options.globalStore.$state - Reactive global state instance.
 * @param {Object} options.eventBus - Global communication bus container.
 * @param {Object} options.eventBus.$bus - Event bus instance to publish and subscribe to events.
 * @param {AbortSignal} options.signal - Abort signal to handle lifecycle cleanup.
 * @returns {Object} Public interface methods for call hardware control.
 * @throws {Error} Re-throws unexpected system errors.
 */
export const createCallDeviceManager = ({ state, refs, globalStore: { $state }, eventBus: { $bus }, webrtc: { $webrtc } = {}, signal }) => {

  /**
   * Helper function to find a ref either directly from component refs or via call-overlay fallback query.
   *
   * @param {string} name - The ref name to locate.
   * @returns {HTMLElement} The located HTML element.
   * @throws {Error} If the ref is missing under contract expectations.
   */
  const getRef = (name) => {
    const fromRefs = refs(name)
    if (fromRefs) {
      return fromRefs
    }
    const overlay = document.querySelector('call-overlay')
    if (overlay) {
      const root = overlay.shadowRoot || overlay
      const queryResult = root.querySelector(`[ref="${name}"]`) || root.querySelector(`#${name}`)
      if (queryResult) {
        return queryResult
      }
    }
    throw new Error(`Ref "${name}" not found in template or overlay context.`)
  }

  /**
   * Request temporary permissions by spawning a temporary stream and immediately stopping it.
   * This forces the browser/OS to prompt the user for camera and microphone access.
   *
   * @returns {Promise<void>} Resolves when the permission check has run.
   * @throws {Error} Re-throws unexpected non-media-related errors.
   */
  const requestTemporaryPermissions = async () => {
    if (window.__E2E_AUDIO_MOCK_INJECTED__) {
      return
    }
    if ($state.localStream && $state.localStream.getTracks().length > 0) {
      return
    }
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
      })
      tempStream.getTracks().forEach(track => track.stop())
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'NotFoundError' || err.name === 'OverconstrainedError' || err.name === 'SecurityError' || err.name === 'AbortError' || err.name === 'TypeError')) {
        try {
          const tempAudio = await navigator.mediaDevices.getUserMedia({ audio: true })
          tempAudio.getTracks().forEach(track => track.stop())
        } catch (audioErr) {
          if (audioErr && (audioErr.name === 'NotAllowedError' || audioErr.name === 'NotFoundError' || audioErr.name === 'OverconstrainedError' || audioErr.name === 'SecurityError' || audioErr.name === 'AbortError' || audioErr.name === 'TypeError')) {
            $bus.emit('ui:show_toast', {
              message: 'Microphone or camera permission was denied or devices were not found.',
              type: 'danger'
            })
            return
          }
          throw audioErr
        }
        return
      }
      throw err
    }
  }

  /**
   * Fetches the available hardware list of microphones, cameras, and speakers from navigator.mediaDevices.
   *
   * @returns {Promise<void>}
   * @throws {Error} Re-throws unexpected non-media errors.
   */
  const fetchHardwareLists = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      state.microphones = devices.filter(d => d.kind === 'audioinput')
      state.cameras = devices.filter(d => d.kind === 'videoinput')
      state.speakers = devices.filter(d => d.kind === 'audiooutput')
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'NotFoundError' || err.name === 'SecurityError' || err.name === 'AbortError')) {
        $bus.emit('ui:show_toast', {
          message: 'Failed to access hardware devices for listing.',
          type: 'danger'
        })
        return
      }
      throw err
    }
  }

  /**
   * Validates stored device preferences in localStorage against current available hardware lists.
   * If stored devices are missing or unplugged, resets active devices to safe defaults.
   *
   * @returns {Promise<void>}
   */
  const bootValidatePreferences = async () => {
    const storedMic = localStorage.getItem('atoll_active_microphone')
    const storedCam = localStorage.getItem('atoll_active_camera')
    const storedSpeaker = localStorage.getItem('atoll_active_speaker')

    if (storedMic && state.microphones.some(m => m.deviceId === storedMic)) {
      state.activeMicId = storedMic
    } else {
      state.activeMicId = state.microphones[0]?.deviceId || 'default'
      localStorage.setItem('atoll_active_microphone', state.activeMicId)
    }

    if (storedCam && state.cameras.some(c => c.deviceId === storedCam)) {
      state.activeCamId = storedCam
    } else {
      state.activeCamId = state.cameras[0]?.deviceId || 'default'
      localStorage.setItem('atoll_active_camera', state.activeCamId)
    }

    if (state.isSpeakerSelectionSupported) {
      if (storedSpeaker && state.speakers.some(s => s.deviceId === storedSpeaker)) {
        state.activeSpeakerId = storedSpeaker
      } else {
        state.activeSpeakerId = state.speakers[0]?.deviceId || 'default'
        localStorage.setItem('atoll_active_speaker', state.activeSpeakerId)
      }
    }
  }

  /**
   * Renders microphones, cameras, and speakers into their respective Atoll select menus.
   * Automatically updates active selections and manages disabled default states.
   *
   * @returns {void}
   */
  const renderDeviceMenus = () => {
    // Render Microphone Select
    const micSelect = getRef('micSelect')
    const micMenu = micSelect.querySelector('.atoll-select-menu') || micSelect
    micMenu.innerHTML = ''
    if (state.microphones.length === 0) {
      const li = document.createElement('li')
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'dropdown-item disabled'
      item.textContent = 'No microphones found'
      li.appendChild(item)
      micMenu.appendChild(li)
      micSelect.value = ''
    } else {
      state.microphones.forEach(mic => {
        const li = document.createElement('li')
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'dropdown-item'
        item.setAttribute('data-value', mic.deviceId)
        item.textContent = mic.label || 'Microphone (' + mic.deviceId.substring(0, 5) + ')'
        li.appendChild(item)
        micMenu.appendChild(li)
      })
      micSelect.value = state.activeMicId
    }

    // Render Camera Select
    const camSelect = getRef('camSelect')
    const camMenu = camSelect.querySelector('.atoll-select-menu') || camSelect
    camMenu.innerHTML = ''
    if (state.cameras.length === 0) {
      const li = document.createElement('li')
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'dropdown-item disabled'
      item.textContent = 'No cameras found'
      li.appendChild(item)
      camMenu.appendChild(li)
      camSelect.value = ''
    } else {
      state.cameras.forEach(cam => {
        const li = document.createElement('li')
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'dropdown-item'
        item.setAttribute('data-value', cam.deviceId)
        item.textContent = cam.label || 'Camera (' + cam.deviceId.substring(0, 5) + ')'
        li.appendChild(item)
        camMenu.appendChild(li)
      })
      camSelect.value = state.activeCamId
    }

    // Render Speaker Select
    const speakerSelect = getRef('speakerSelect')
    if (state.isSpeakerSelectionSupported) {
      const speakerMenu = speakerSelect.querySelector('.atoll-select-menu') || speakerSelect
      speakerMenu.innerHTML = ''
      if (state.speakers.length === 0) {
        const li = document.createElement('li')
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'dropdown-item disabled'
        item.textContent = 'No speakers found'
        li.appendChild(item)
        speakerMenu.appendChild(li)
        speakerSelect.value = ''
      } else {
        state.speakers.forEach(speaker => {
          const li = document.createElement('li')
          const item = document.createElement('button')
          item.type = 'button'
          item.className = 'dropdown-item'
          item.setAttribute('data-value', speaker.deviceId)
          item.textContent = speaker.label || 'Speaker (' + speaker.deviceId.substring(0, 5) + ')'
          li.appendChild(item)
          speakerMenu.appendChild(li)
        })
        speakerSelect.value = state.activeSpeakerId
      }
    }
  }

  /**
   * Sets the active microphone to the specified deviceId, updates localStorage, and hot-swaps
   * the audio track in the active WebRTC localStream.
   *
   * @param {string} deviceId - The device ID of the target microphone.
   * @returns {Promise<void>}
   * @throws {Error} Re-throws unexpected non-media errors.
   */
  const selectMicrophone = async (deviceId) => {
    const prevMicId = state.activeMicId
    state.activeMicId = deviceId
    localStorage.setItem('atoll_active_microphone', deviceId)
    renderDeviceMenus()

    const isCallActive = ['active', 'connected'].includes(state.callStatus) || ['active', 'connected'].includes($state.callStatus)
    if (!isCallActive || !$state.localStream) {
      return
    }

    const audioConstraints = {
      deviceId: { exact: deviceId },
      noiseSuppression: state.isNoiseCancellationEnabled,
      echoCancellation: state.isNoiseCancellationEnabled,
      autoGainControl: state.isNoiseCancellationEnabled
    }

    let newTrack = null
    const oldAudioTrack = $state.localStream.getAudioTracks()[0]

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      newTrack = newStream.getAudioTracks()[0]

      // Mute State Privacy: match active mute state prior to replaceTrack
      newTrack.enabled = Boolean(state.isAudioEnabled)

      const audioSender = $webrtc?.getAudioSender($state.activeCallId)
      if (audioSender) {
        await audioSender.replaceTrack(newTrack)
      }

      if (oldAudioTrack) {
        $state.localStream.removeTrack(oldAudioTrack)
      }
      $state.localStream.addTrack(newTrack)
      $bus.emit('call:local_stream_available', { stream: $state.localStream })

      // Non-Destructive Ordering: Stop old track strictly AFTER replaceTrack and localStream swap succeed
      if (oldAudioTrack) {
        oldAudioTrack.stop()
      }
    } catch (err) {
      if (newTrack) {
        try {
          newTrack.stop()
        } catch (_) {
        }
      }

      state.activeMicId = prevMicId
      localStorage.setItem('atoll_active_microphone', prevMicId)
      renderDeviceMenus()

      $bus.emit('ui:show_toast', {
        message: 'Failed to switch microphone. Continuing with previous device.',
        variant: 'warning',
        type: 'warning'
      })

      if (err && (err.name === 'NotAllowedError' || err.name === 'NotFoundError' || err.name === 'OverconstrainedError' || err.name === 'SecurityError' || err.name === 'AbortError' || err.name === 'TypeError' || err.name === 'InvalidStateError')) {
        return
      }
      throw err
    }
  }

  /**
   * Sets the active camera to the specified deviceId, updates localStorage, and hot-swaps
   * the video track in the active WebRTC localStream.
   *
   * @param {string} deviceId - The device ID of the target camera.
   * @returns {Promise<void>}
   * @throws {Error} Re-throws unexpected non-media errors.
   */
  const selectCamera = async (deviceId) => {
    const prevCamId = state.activeCamId
    state.activeCamId = deviceId
    localStorage.setItem('atoll_active_camera', deviceId)
    renderDeviceMenus()

    const isCallActive = ['active', 'connected'].includes(state.callStatus) || ['active', 'connected'].includes($state.callStatus)
    if (!isCallActive || !$state.localStream) {
      return
    }

    let newTrack = null
    const oldVideoTrack = $state.localStream.getVideoTracks()[0]

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } })
      newTrack = newStream.getVideoTracks()[0]

      // Mute State Privacy: match active video mute state prior to replaceTrack
      newTrack.enabled = Boolean(state.isVideoEnabled)

      const videoSender = $webrtc?.getVideoSender($state.activeCallId)
      if (videoSender) {
        await videoSender.replaceTrack(newTrack)
      }

      if (oldVideoTrack) {
        $state.localStream.removeTrack(oldVideoTrack)
      }
      $state.localStream.addTrack(newTrack)
      $bus.emit('call:local_stream_available', { stream: $state.localStream })
      applyLocalVideoEffects()

      // Non-Destructive Ordering: Stop old track strictly AFTER replaceTrack and localStream swap succeed
      if (oldVideoTrack) {
        oldVideoTrack.stop()
      }
    } catch (err) {
      if (newTrack) {
        try {
          newTrack.stop()
        } catch (_) {
        }
      }

      state.activeCamId = prevCamId
      localStorage.setItem('atoll_active_camera', prevCamId)
      renderDeviceMenus()

      $bus.emit('ui:show_toast', {
        message: 'Failed to switch camera. Continuing with previous device.',
        variant: 'warning',
        type: 'warning'
      })

      if (err && (err.name === 'NotAllowedError' || err.name === 'NotFoundError' || err.name === 'OverconstrainedError' || err.name === 'SecurityError' || err.name === 'AbortError' || err.name === 'TypeError' || err.name === 'InvalidStateError')) {
        return
      }
      throw err
    }
  }

  /**
   * Sets the active speaker to the specified deviceId, updates localStorage, and applies
   * the speaker sink ID to all remote video elements on supported browsers.
   *
   * @param {string} deviceId - The device ID of the target speaker.
   * @returns {Promise<void>}
   * @throws {Error} Re-throws unexpected non-media errors.
   */
  const selectSpeaker = async (deviceId) => {
    if (!state.isSpeakerSelectionSupported) {
      return
    }
    state.activeSpeakerId = deviceId
    localStorage.setItem('atoll_active_speaker', deviceId)
    renderDeviceMenus()

    const remoteVideos = document.querySelectorAll('video-grid video')
    for (const video of remoteVideos) {
      try {
        await video.setSinkId(deviceId)
      } catch (err) {
        if (err && (err.name === 'NotFoundError' || err.name === 'NotAllowedError' || err.name === 'SecurityError' || err.name === 'AbortError')) {
          $bus.emit('ui:show_toast', {
            message: 'Failed to set speaker output device on some video elements.',
            type: 'warning'
          })
          continue
        }
        throw err
      }
    }
  }

  /**
   * Applies CSS visual filters (such as background blur) to the local video element.
   *
   * @returns {void}
   */
  const applyLocalVideoEffects = () => {
    const videoGrid = document.querySelector('video-grid') || getRef('videoGrid')
    if (!videoGrid) {
      return
    }

    const me = $state.currentUser || { name: 'local-user' }
    const localTile = videoGrid.querySelector(`[data-participant-id="${me.id}"]`)
      || videoGrid.querySelector('.grid-tile')

    if (!localTile) {
      return
    }

    const videoEl = localTile.querySelector('.tile-video') || localTile.querySelector('video')
    if (!videoEl) {
      return
    }

    videoEl.style.filter = state.isBackgroundBlurEnabled ? 'blur(10px)' : ''
  }

  let snapshot = null

  /**
   * Takes a snapshot of the current active device IDs and effect settings
   * to allow rolling back to these states if the user cancels or discards settings changes.
   *
   * @returns {void}
   */
  const takeSnapshot = () => {
    snapshot = {
      activeMicId: state.activeMicId,
      activeCamId: state.activeCamId,
      activeSpeakerId: state.activeSpeakerId,
      isNoiseCancellationEnabled: state.isNoiseCancellationEnabled,
      isBackgroundBlurEnabled: state.isBackgroundBlurEnabled
    }
  }

  /**
   * Reverts active device settings and effects back to the states recorded in the snapshot.
   * Automatically updates localStorage and triggers necessary track swaps on active streams.
   *
   * @returns {Promise<void>}
   * @throws {Error} Re-throws unexpected exceptions during device rollback.
   */
  const rollback = async () => {
    if (!snapshot) {
      return
    }

    const changedMic = state.activeMicId !== snapshot.activeMicId
    const changedCam = state.activeCamId !== snapshot.activeCamId
    const changedSpeaker = state.activeSpeakerId !== snapshot.activeSpeakerId
    const changedNC = state.isNoiseCancellationEnabled !== snapshot.isNoiseCancellationEnabled
    const changedBlur = state.isBackgroundBlurEnabled !== snapshot.isBackgroundBlurEnabled

    state.activeMicId = snapshot.activeMicId
    state.activeCamId = snapshot.activeCamId
    state.activeSpeakerId = snapshot.activeSpeakerId
    state.isNoiseCancellationEnabled = snapshot.isNoiseCancellationEnabled
    state.isBackgroundBlurEnabled = snapshot.isBackgroundBlurEnabled

    localStorage.setItem('atoll_active_microphone', state.activeMicId)
    localStorage.setItem('atoll_active_camera', state.activeCamId)
    localStorage.setItem('atoll_active_speaker', state.activeSpeakerId)
    localStorage.setItem('atoll_noise_cancellation', state.isNoiseCancellationEnabled)
    localStorage.setItem('atoll_background_blur', state.isBackgroundBlurEnabled)

    // Sync UI components
    const toggleNoiseCancellation = getRef('toggleNoiseCancellation')
    toggleNoiseCancellation.checked = state.isNoiseCancellationEnabled

    const toggleBackgroundBlur = getRef('toggleBackgroundBlur')
    toggleBackgroundBlur.checked = state.isBackgroundBlurEnabled

    renderDeviceMenus()

    if (state.callStatus === 'active') {
      if (changedMic || changedNC) {
        await selectMicrophone(state.activeMicId)
      }
      if (changedCam) {
        await selectCamera(state.activeCamId)
      }
      if (changedSpeaker) {
        await selectSpeaker(state.activeSpeakerId)
      }
      if (changedBlur) {
        applyLocalVideoEffects()
      }
    } else {
      applyLocalVideoEffects()
    }

    snapshot = null
  }

  /**
   * Performs the initial enumeration and boot validation sequence: determines browser
   * compatibility, prompts user media permissions, fetches hardware lists, loads/validates
   * storage preferences, and updates UI layouts.
   *
   * @returns {Promise<void>}
   * @throws {Error} Re-throws unexpected exceptions during device bootstrap.
   */
  const enumerateAndBootDevices = async () => {
    // Capability Gating
    state.isSpeakerSelectionSupported = typeof HTMLMediaElement.prototype.setSinkId !== 'undefined'
    const speakerFallbackEl = getRef('speakerFallback')
    const speakerSelectEl = getRef('speakerSelect')

    if (!state.isSpeakerSelectionSupported) {
      speakerFallbackEl.classList.remove('d-none')
      speakerSelectEl.classList.add('d-none')
    } else {
      speakerFallbackEl.classList.add('d-none')
      speakerSelectEl.classList.remove('d-none')
    }

    await requestTemporaryPermissions()
    await fetchHardwareLists()
    await bootValidatePreferences()
    renderDeviceMenus()
    applyLocalVideoEffects()
  }

  /**
   * Listens for hardware device hot-swapping events. When an active microphone is unplugged mid-call,
   * performs a safe fallback: stops local audio tracks, updates state to disabled, and alerts the user.
   *
   * @returns {Promise<void>}
   */
  const onDeviceChange = async () => {
    const oldMics = [...state.microphones]
    const oldCams = [...state.cameras]
    const oldSpeakers = [...state.speakers]

    await fetchHardwareLists()

    const isCallActive = ['active', 'connected', 'outgoing'].includes(state.callStatus) || ['active', 'connected', 'outgoing'].includes($state.callStatus)

    if (!isCallActive) {
      await bootValidatePreferences()
      renderDeviceMenus()
      return
    }

    renderDeviceMenus()

    // 1. Microphone Disconnection Recovery
    const currentMicExists = state.microphones.some(m => m.deviceId === state.activeMicId)
    if (oldMics.length > 0 && !currentMicExists) {
      const lostMicId = state.activeMicId
      let fallbackSuccess = false

      try {
        await selectMicrophone('default')
        if (state.activeMicId === 'default') {
          fallbackSuccess = true
          $bus.emit('ui:show_toast', {
            message: 'Microphone disconnected. Switched to default microphone.',
            variant: 'info',
            type: 'info'
          })
        }
      } catch (_) {
        fallbackSuccess = false
      }

      if (!fallbackSuccess) {
        const audioSender = $webrtc?.getAudioSender($state.activeCallId)
        if (audioSender) {
          try {
            await audioSender.replaceTrack(null)
          } catch (_) {
          }
        }

        const localStream = $state.localStream || state.localStream
        if (localStream) {
          const tracks = localStream.getAudioTracks()
          tracks.forEach(track => {
            track.enabled = false
            track.stop()
            localStream.removeTrack(track)
          })
        }

        state.isAudioEnabled = false
        state.isLocalSpeaking = false
        $state.isAudioEnabled = false
        $state.isLocalSpeaking = false
        if (typeof $state.set === 'function') {
          $state.set('isAudioEnabled', false)
          $state.set('isLocalSpeaking', false)
        }

        localStorage.removeItem('atoll_active_microphone')
        state.activeMicId = 'default'

        $bus.emit('ui:show_toast', {
          message: 'Microphone disconnected.',
          variant: 'danger',
          type: 'danger'
        })

        $bus.emit('call:device_lost', {
          kind: 'audio',
          deviceId: lostMicId,
          callId: $state.activeCallId || null,
          roomId: $state.activeCallRoomId || null
        })

        renderDeviceMenus()
      }
    }

    // 2. Camera Disconnection Recovery
    const currentCamExists = state.cameras.some(c => c.deviceId === state.activeCamId)
    if (oldCams.length > 0 && !currentCamExists) {
      const lostCamId = state.activeCamId
      let fallbackSuccess = false

      try {
        await selectCamera('default')
        if (state.activeCamId === 'default') {
          fallbackSuccess = true
          $bus.emit('ui:show_toast', {
            message: 'Camera disconnected. Switched to default camera.',
            variant: 'info',
            type: 'info'
          })
        }
      } catch (_) {
        fallbackSuccess = false
      }

      if (!fallbackSuccess) {
        const videoSender = $webrtc?.getVideoSender($state.activeCallId)
        if (videoSender) {
          try {
            await videoSender.replaceTrack(null)
          } catch (_) {
          }
        }

        const localStream = $state.localStream || state.localStream
        if (localStream) {
          const tracks = localStream.getVideoTracks()
          tracks.forEach(track => {
            track.enabled = false
            track.stop()
            localStream.removeTrack(track)
          })
        }

        state.isVideoEnabled = false
        $state.isVideoEnabled = false
        if (typeof $state.set === 'function') {
          $state.set('isVideoEnabled', false)
        }

        localStorage.removeItem('atoll_active_camera')
        state.activeCamId = 'default'

        $bus.emit('ui:show_toast', {
          message: 'Camera disconnected.',
          variant: 'danger',
          type: 'danger'
        })

        $bus.emit('call:device_lost', {
          kind: 'video',
          deviceId: lostCamId,
          callId: $state.activeCallId || null,
          roomId: $state.activeCallRoomId || null
        })

        renderDeviceMenus()
      }
    }

    // 3. Speaker Disconnection Recovery
    if (state.isSpeakerSelectionSupported) {
      const currentSpeakerExists = state.speakers.some(s => s.deviceId === state.activeSpeakerId)
      if (oldSpeakers.length > 0 && !currentSpeakerExists) {
        const lostSpeakerId = state.activeSpeakerId
        state.activeSpeakerId = 'default'
        localStorage.setItem('atoll_active_speaker', 'default')

        const remoteVideos = document.querySelectorAll('video-grid video')
        for (const video of remoteVideos) {
          if (typeof video.setSinkId === 'function') {
            try {
              await video.setSinkId('')
            } catch (_) {
            }
          }
        }

        renderDeviceMenus()

        $bus.emit('ui:show_toast', {
          message: 'Speaker disconnected. Resetting to default speaker.',
          variant: 'info',
          type: 'info'
        })

        $bus.emit('call:device_lost', {
          kind: 'speaker',
          deviceId: lostSpeakerId,
          callId: $state.activeCallId || null,
          roomId: $state.activeCallRoomId || null
        })
      }
    }
  }

  // Bind effect switches
  const toggleNoiseCancellation = getRef('toggleNoiseCancellation')
  state.isNoiseCancellationEnabled = localStorage.getItem('atoll_noise_cancellation') !== 'false'
  toggleNoiseCancellation.checked = state.isNoiseCancellationEnabled
  toggleNoiseCancellation.addEventListener('change', (e) => {
    state.isNoiseCancellationEnabled = e.target.checked
    localStorage.setItem('atoll_noise_cancellation', state.isNoiseCancellationEnabled)
    if (state.callStatus === 'active') {
      selectMicrophone(state.activeMicId)
    }
  })

  const toggleBackgroundBlur = getRef('toggleBackgroundBlur')
  state.isBackgroundBlurEnabled = localStorage.getItem('atoll_background_blur') === 'true'
  toggleBackgroundBlur.checked = state.isBackgroundBlurEnabled
  toggleBackgroundBlur.addEventListener('change', (e) => {
    state.isBackgroundBlurEnabled = e.target.checked
    localStorage.setItem('atoll_background_blur', state.isBackgroundBlurEnabled)
    applyLocalVideoEffects()
  })

  // Bind dropdown change events
  const micSelect = getRef('micSelect')
  micSelect.addEventListener('atoll-change', (e) => {
    selectMicrophone(e.detail.value)
  })

  const camSelect = getRef('camSelect')
  camSelect.addEventListener('atoll-change', (e) => {
    selectCamera(e.detail.value)
  })

  const speakerSelect = getRef('speakerSelect')
  speakerSelect.addEventListener('atoll-change', (e) => {
    selectSpeaker(e.detail.value)
  })

  navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)
  signal.addEventListener('abort', () => {
    navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
  })

  $bus.on('call:local_stream_available', () => {
    setTimeout(applyLocalVideoEffects, 100)
  }, { signal })

  return {
    enumerateAndBootDevices,
    renderDeviceMenus,
    selectMicrophone,
    selectCamera,
    selectSpeaker,
    applyLocalVideoEffects,
    takeSnapshot,
    rollback
  }
}
