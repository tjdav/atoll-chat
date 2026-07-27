/**
 * Manages audio/video hardware enumeration, hot-swapping, device loss fail-safes,
 * and media effect settings (noise cancellation, background blur).
 */

/**
 *
 */
export const createCallDeviceManager = ({ state, refs, globalStore, eventBus, signal }) => {
  const { $state } = globalStore
  const { $bus } = eventBus

  const getRef = (name) => {
    const fromRefs = refs(name)
    if (fromRefs) {
      return fromRefs
    }
    const overlay = document.querySelector('call-overlay')
    if (overlay) {
      if (overlay.shadowRoot) {
        return overlay.shadowRoot.querySelector(`[ref="${name}"]`) || overlay.shadowRoot.querySelector(`#${name}`)
      }
      return overlay.querySelector(`[ref="${name}"]`) || overlay.querySelector(`#${name}`)
    }
    return null
  }

  // Capability Gating
  state.isSpeakerSelectionSupported = typeof HTMLMediaElement.prototype.setSinkId !== 'undefined'
  const speakerFallbackEl = getRef('speakerFallback')
  if (!state.isSpeakerSelectionSupported && speakerFallbackEl) {
    speakerFallbackEl.classList.remove('d-none')
  }

  const requestTemporaryPermissions = async () => {
    if (window.__E2E_AUDIO_MOCK_INJECTED__) {
      console.log('[call-device-manager] E2E audio mock detected, skipping temporary permission stream.')
      return
    }
    if (state.localStream && state.localStream.getTracks().length > 0) {
      console.log('[call-device-manager] Active localStream already exists, skipping temporary permission stream.')
      return
    }
    try {
      console.log('[call-device-manager] Spawning temporary media stream to prompt native OS permissions...')
      const tempStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
      })
      tempStream.getTracks().forEach(track => track.stop())
      console.log('[call-device-manager] Temporary permission granted and tracks stopped.')
    } catch (err) {
      console.warn('[call-device-manager] Temporary permission stream failed, attempting audio-only...', err)
      try {
        const tempAudio = await navigator.mediaDevices.getUserMedia({ audio: true })
        tempAudio.getTracks().forEach(track => track.stop())
      } catch (audioErr) {
        console.error('[call-device-manager] Permanent permission failure or user denied access:', audioErr)
      }
    }
  }

  const fetchHardwareLists = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      state.microphones = devices.filter(d => d.kind === 'audioinput')
      state.cameras = devices.filter(d => d.kind === 'videoinput')
      state.speakers = devices.filter(d => d.kind === 'audiooutput')
      console.log('[call-device-manager] Enumerate devices successful:', {
        mics: state.microphones.length,
        cams: state.cameras.length,
        speakers: state.speakers.length
      })
    } catch (err) {
      console.error('[call-device-manager] Failed to enumerate hardware devices:', err)
    }
  }

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

  const renderDeviceMenus = () => {
    // Render Microphone list
    const micContainer = getRef('micList')
    if (micContainer) {
      micContainer.innerHTML = ''
      if (state.microphones.length === 0) {
        micContainer.innerHTML = `<div class="p-2 text-muted" style="font-size: 0.8125rem; padding-left: 1rem;">No microphones found</div>`
      } else {
        state.microphones.forEach(mic => {
          const item = document.createElement('atoll-list-item')
          item.setAttribute('title', mic.label || 'Microphone (' + mic.deviceId.substring(0, 5) + ')')
          item.setAttribute('clickable', 'true')
          item.setAttribute('data-device-id', mic.deviceId)

          if (state.activeMicId === mic.deviceId) {
            item.setAttribute('selected', 'true')
            const checkIcon = document.createElement('atoll-icon')
            checkIcon.setAttribute('name', 'check')
            checkIcon.setAttribute('active', 'true')
            checkIcon.setAttribute('slot', 'right')
            item.appendChild(checkIcon)
          }

          item.addEventListener('atoll-item-click', () => selectMicrophone(mic.deviceId))
          micContainer.appendChild(item)
        })
      }
    }

    // Render Camera list
    const camContainer = getRef('camList')
    if (camContainer) {
      camContainer.innerHTML = ''
      if (state.cameras.length === 0) {
        camContainer.innerHTML = `<div class="p-2 text-muted" style="font-size: 0.8125rem; padding-left: 1rem;">No cameras found</div>`
      } else {
        state.cameras.forEach(cam => {
          const item = document.createElement('atoll-list-item')
          item.setAttribute('title', cam.label || 'Camera (' + cam.deviceId.substring(0, 5) + ')')
          item.setAttribute('clickable', 'true')
          item.setAttribute('data-device-id', cam.deviceId)

          if (state.activeCamId === cam.deviceId) {
            item.setAttribute('selected', 'true')
            const checkIcon = document.createElement('atoll-icon')
            checkIcon.setAttribute('name', 'check')
            checkIcon.setAttribute('active', 'true')
            checkIcon.setAttribute('slot', 'right')
            item.appendChild(checkIcon)
          }

          item.addEventListener('atoll-item-click', () => selectCamera(cam.deviceId))
          camContainer.appendChild(item)
        })
      }
    }

    // Render Speaker list
    const speakerContainer = getRef('speakerList')
    if (speakerContainer && state.isSpeakerSelectionSupported) {
      speakerContainer.innerHTML = ''
      if (state.speakers.length === 0) {
        speakerContainer.innerHTML = `<div class="p-2 text-muted" style="font-size: 0.8125rem; padding-left: 1rem;">No speakers found</div>`
      } else {
        state.speakers.forEach(speaker => {
          const item = document.createElement('atoll-list-item')
          item.setAttribute('title', speaker.label || 'Speaker (' + speaker.deviceId.substring(0, 5) + ')')
          item.setAttribute('clickable', 'true')
          item.setAttribute('data-device-id', speaker.deviceId)

          if (state.activeSpeakerId === speaker.deviceId) {
            item.setAttribute('selected', 'true')
            const checkIcon = document.createElement('atoll-icon')
            checkIcon.setAttribute('name', 'check')
            checkIcon.setAttribute('active', 'true')
            checkIcon.setAttribute('slot', 'right')
            item.appendChild(checkIcon)
          }

          item.addEventListener('atoll-item-click', () => selectSpeaker(speaker.deviceId))
          speakerContainer.appendChild(item)
        })
      }
    }
  }

  const selectMicrophone = async (deviceId) => {
    state.activeMicId = deviceId
    localStorage.setItem('atoll_active_microphone', deviceId)
    renderDeviceMenus()

    if (state.callStatus !== 'active' || !state.localStream) {
      return
    }

    const audioConstraints = {
      deviceId: { exact: deviceId },
      noiseSuppression: state.isNoiseCancellationEnabled,
      echoCancellation: state.isNoiseCancellationEnabled,
      autoGainControl: state.isNoiseCancellationEnabled
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      const newTrack = newStream.getAudioTracks()[0]

      if (!state.isAudioEnabled) {
        newTrack.enabled = false
      }

      const pc = window.__E2E_PEER_CONNECTION__
      if (pc) {
        const senders = pc.getSenders()
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio')
        if (audioSender) {
          await audioSender.replaceTrack(newTrack)
          console.log('[call-device-manager] Active WebRTC audio track swapped successfully.')
        }
      }

      const oldAudioTrack = state.localStream.getAudioTracks()[0]
      if (oldAudioTrack) {
        oldAudioTrack.stop()
        state.localStream.removeTrack(oldAudioTrack)
      }
      state.localStream.addTrack(newTrack)
      $bus.emit('call:local_stream_available', { stream: state.localStream })
    } catch (err) {
      console.error('[call-device-manager] Failed to swap active audio track:', err)
    }
  }

  const selectCamera = async (deviceId) => {
    state.activeCamId = deviceId
    localStorage.setItem('atoll_active_camera', deviceId)
    renderDeviceMenus()

    if (state.callStatus !== 'active' || !state.localStream) {
      return
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } })
      const newTrack = newStream.getVideoTracks()[0]

      if (!state.isVideoEnabled) {
        newTrack.enabled = false
      }

      const pc = window.__E2E_PEER_CONNECTION__
      if (pc) {
        const senders = pc.getSenders()
        const videoSender = senders.find(s => s.track && s.track.kind === 'video')
        if (videoSender) {
          await videoSender.replaceTrack(newTrack)
          console.log('[call-device-manager] Active WebRTC video track swapped successfully.')
        }
      }

      const oldVideoTrack = state.localStream.getVideoTracks()[0]
      if (oldVideoTrack) {
        oldVideoTrack.stop()
        state.localStream.removeTrack(oldVideoTrack)
      }
      state.localStream.addTrack(newTrack)
      $bus.emit('call:local_stream_available', { stream: state.localStream })
      applyLocalVideoEffects()
    } catch (err) {
      console.error('[call-device-manager] Failed to swap active video track:', err)
    }
  }

  const selectSpeaker = async (deviceId) => {
    if (!state.isSpeakerSelectionSupported) {
      return
    }
    state.activeSpeakerId = deviceId
    localStorage.setItem('atoll_active_speaker', deviceId)
    renderDeviceMenus()

    const remoteVideos = document.querySelectorAll('video-grid video')
    remoteVideos.forEach(async (video) => {
      try {
        await video.setSinkId(deviceId)
        console.log(`[call-device-manager] Speaker sink ID set successfully to: ${deviceId}`)
      } catch (err) {
        console.error('[call-device-manager] Failed to set speaker sink ID:', err)
      }
    })
  }

  const applyLocalVideoEffects = () => {
    const videoGrid = document.querySelector('video-grid') || getRef('videoGrid')
    if (!videoGrid) {
      return
    }

    const me = $state.currentUser || { id: 'local-user' }
    const localTile = videoGrid.querySelector(`[data-participant-id="${me.id}"]`)
      || videoGrid.querySelector('.grid-tile')

    if (localTile) {
      const videoEl = localTile.querySelector('.tile-video') || localTile.querySelector('video')
      if (videoEl) {
        if (state.isBackgroundBlurEnabled) {
          videoEl.style.filter = 'blur(10px)'
        } else {
          videoEl.style.filter = ''
        }
      }
    }
  }

  const enumerateAndBootDevices = async () => {
    await requestTemporaryPermissions()
    await fetchHardwareLists()
    await bootValidatePreferences()
    renderDeviceMenus()
    applyLocalVideoEffects()
  }

  const onDeviceChange = async () => {
    console.log('[call-device-manager] Global media device change event triggered.')
    const oldMics = [...state.microphones]
    await fetchHardwareLists()
    renderDeviceMenus()

    if (state.callStatus !== 'active') {
      return
    }

    const currentActiveMicStillExists = state.microphones.some(m => m.deviceId === state.activeMicId)
    if (oldMics.length > 0 && !currentActiveMicStillExists) {
      console.warn('[call-device-manager] Active microphone unplugged mid-call! Fail-safe executing...')

      const localStream = $state.localStream || state.localStream
      if (localStream) {
        const tracks = localStream.getAudioTracks()
        tracks.forEach(track => {
          track.enabled = false
          track.stop()
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
        type: 'danger'
      })

      renderDeviceMenus()
    }
  }

  // Bind effect switches if refs exist
  const toggleNoiseCancellation = getRef('toggleNoiseCancellation')
  if (toggleNoiseCancellation) {
    state.isNoiseCancellationEnabled = localStorage.getItem('atoll_noise_cancellation') !== 'false'
    toggleNoiseCancellation.checked = state.isNoiseCancellationEnabled
    toggleNoiseCancellation.addEventListener('change', (e) => {
      state.isNoiseCancellationEnabled = e.target.checked
      localStorage.setItem('atoll_noise_cancellation', state.isNoiseCancellationEnabled)
      if (state.callStatus === 'active') {
        selectMicrophone(state.activeMicId)
      }
    })
  }

  const toggleBackgroundBlur = getRef('toggleBackgroundBlur')
  if (toggleBackgroundBlur) {
    state.isBackgroundBlurEnabled = localStorage.getItem('atoll_background_blur') === 'true'
    toggleBackgroundBlur.checked = state.isBackgroundBlurEnabled
    toggleBackgroundBlur.addEventListener('change', (e) => {
      state.isBackgroundBlurEnabled = e.target.checked
      localStorage.setItem('atoll_background_blur', state.isBackgroundBlurEnabled)
      applyLocalVideoEffects()
    })
  }

  navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)
  signal.addEventListener('abort', () => {
    navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
  })

  $bus.on('call:local_stream_available', () => {
    setTimeout(applyLocalVideoEffects, 100)
  }, { signal })

  return {
    enumerateAndBootDevices,
    selectMicrophone,
    selectCamera,
    selectSpeaker,
    applyLocalVideoEffects
  }
}
