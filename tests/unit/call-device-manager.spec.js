import { test } from 'node:test'
import assert from 'node:assert'
import { createCallDeviceManager } from '../../src/utils/call/callDeviceManager.js'

// Polyfill minimal browser DOM & WebRTC environment
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => []
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  }
}

function createMockTrack (kind) {
  let enabled = true
  let stopped = false
  return {
    kind,
    get enabled () {
      return enabled
    },
    set enabled (v) {
      enabled = Boolean(v)
    },
    get stopped () {
      return stopped
    },
    stop () {
      stopped = true
    }
  }
}

function createMockStream (tracks = []) {
  const currentTracks = [...tracks]
  return {
    getAudioTracks: () => currentTracks.filter(t => t.kind === 'audio'),
    getVideoTracks: () => currentTracks.filter(t => t.kind === 'video'),
    getTracks: () => [...currentTracks],
    addTrack (t) {
      currentTracks.push(t)
    },
    removeTrack (t) {
      const idx = currentTracks.indexOf(t)
      if (idx !== -1) {
        currentTracks.splice(idx, 1)
      }
    }
  }
}

function setupTestEnvironment () {
  const toasts = []
  const busEvents = []
  const eventBus = {
    $bus: {
      emit (event, payload) {
        busEvents.push({
          event,
          payload
        })
        if (event === 'ui:show_toast') {
          toasts.push(payload)
        }
      },
      on () {
      }
    }
  }

  const globalStore = {
    $state: {
      callStatus: 'connected',
      activeCallId: 'call-123',
      activeCallRoomId: 'room-456',
      localStream: null,
      isAudioEnabled: true,
      isVideoEnabled: true,
      isLocalSpeaking: false
    }
  }

  const localState = {
    callStatus: 'connected',
    activeMicId: 'mic-1',
    activeCamId: 'cam-1',
    activeSpeakerId: 'speaker-1',
    isAudioEnabled: true,
    isVideoEnabled: true,
    isLocalSpeaking: false,
    microphones: [{
      deviceId: 'mic-1',
      label: 'Mic 1'
    }, {
      deviceId: 'mic-2',
      label: 'Mic 2'
    }],
    cameras: [{
      deviceId: 'cam-1',
      label: 'Cam 1'
    }, {
      deviceId: 'cam-2',
      label: 'Cam 2'
    }],
    speakers: [{
      deviceId: 'speaker-1',
      label: 'Speaker 1'
    }],
    isSpeakerSelectionSupported: true
  }

  const dummyEl = {
    innerHTML: '',
    value: '',
    checked: false,
    classList: {
      add () {
      },
      remove () {
      }
    },
    querySelector: () => dummyEl,
    appendChild (child) {
    },
    addEventListener (evt, cb) {
    }
  }

  const refs = (name) => dummyEl

  const audioSender = {
    replacedTrack: null,
    async replaceTrack (track) {
      this.replacedTrack = track
    }
  }

  const videoSender = {
    replacedTrack: null,
    async replaceTrack (track) {
      this.replacedTrack = track
    }
  }

  const mockPc = {
    getSenders: () => [audioSender, videoSender]
  }

  const webrtc = {
    $webrtc: {
      getPeerConnection: (id) => mockPc,
      getAudioSender: (id) => audioSender,
      getVideoSender: (id) => videoSender
    }
  }

  let deviceChangeHandler = null
  globalThis.navigator = {
    mediaDevices: {
      enumerateDevices: async () => [
        {
          kind: 'audioinput',
          deviceId: localState.activeMicId,
          label: 'Mic'
        },
        {
          kind: 'videoinput',
          deviceId: localState.activeCamId,
          label: 'Cam'
        },
        {
          kind: 'audiooutput',
          deviceId: localState.activeSpeakerId,
          label: 'Speaker'
        }
      ],
      getUserMedia: async (constraints) => {
        if (constraints.audio) {
          return createMockStream([createMockTrack('audio')])
        }
        if (constraints.video) {
          return createMockStream([createMockTrack('video')])
        }
        return createMockStream([createMockTrack('audio'), createMockTrack('video')])
      },
      addEventListener (evt, fn) {
        if (evt === 'devicechange') {
          deviceChangeHandler = fn
        }
      },
      removeEventListener (evt, fn) {
      }
    }
  }

  const controller = new AbortController()

  const deviceManager = createCallDeviceManager({
    state: localState,
    refs,
    globalStore,
    eventBus,
    webrtc,
    signal: controller.signal
  })

  return {
    deviceManager,
    localState,
    globalState: globalStore.$state,
    audioSender,
    videoSender,
    toasts,
    busEvents,
    webrtc,
    getDeviceChangeHandler: () => deviceChangeHandler
  }
}

test('Call Device Manager Unit Tests', async (t) => {
  await t.test('1. Non-Destructive Audio Track Swap & Ordering', async () => {
    const env = setupTestEnvironment()
    const oldAudioTrack = createMockTrack('audio')
    env.globalState.localStream = createMockStream([oldAudioTrack])

    let replaceTrackCalledFirst = false
    env.audioSender.replaceTrack = async (track) => {
      env.audioSender.replacedTrack = track
      replaceTrackCalledFirst = !oldAudioTrack.stopped
    }

    await env.deviceManager.selectMicrophone('mic-2')

    assert.strictEqual(replaceTrackCalledFirst, true, 'replaceTrack must resolve BEFORE oldTrack.stop()')
    assert.strictEqual(oldAudioTrack.stopped, true, 'oldTrack must be stopped after handoff')
    assert.strictEqual(env.localState.activeMicId, 'mic-2')
    assert.ok(env.audioSender.replacedTrack)
    assert.notStrictEqual(env.audioSender.replacedTrack, oldAudioTrack)
  })

  await t.test('2. Mute State Privacy Preservation', async () => {
    const env = setupTestEnvironment()
    env.localState.isAudioEnabled = false
    env.globalState.isAudioEnabled = false
    const oldAudioTrack = createMockTrack('audio')
    env.globalState.localStream = createMockStream([oldAudioTrack])

    let acquiredTrackEnabledState = null
    env.audioSender.replaceTrack = async (newTrack) => {
      acquiredTrackEnabledState = newTrack.enabled
    }

    await env.deviceManager.selectMicrophone('mic-2')

    assert.strictEqual(acquiredTrackEnabledState, false, 'newTrack.enabled must be set to false prior to replaceTrack call')
  })

  await t.test('3. GUM / replaceTrack Failure Swap Reversion & Warning Toast', async () => {
    const env = setupTestEnvironment()
    const oldAudioTrack = createMockTrack('audio')
    env.globalState.localStream = createMockStream([oldAudioTrack])
    env.localState.activeMicId = 'mic-1'

    // Force getUserMedia failure
    globalThis.navigator.mediaDevices.getUserMedia = async () => {
      const err = new Error('Permission denied')
      err.name = 'NotAllowedError'
      throw err
    }

    await env.deviceManager.selectMicrophone('mic-2')

    assert.strictEqual(oldAudioTrack.stopped, false, 'Old track must remain live and streaming on failure')
    assert.strictEqual(env.localState.activeMicId, 'mic-1', 'activeMicId must revert to previous working device')

    const warningToast = env.toasts.find(t => t.message.includes('Failed to switch microphone'))
    assert.ok(warningToast, 'Warning toast must be presented')
    assert.strictEqual(warningToast.variant, 'warning')
  })

  await t.test('4. Mid-Call Microphone Disconnection & Default Fallback Success', async () => {
    const env = setupTestEnvironment()
    const oldAudioTrack = createMockTrack('audio')
    env.globalState.localStream = createMockStream([oldAudioTrack])
    env.localState.activeMicId = 'mic-usb'
    env.localState.microphones = [{
      deviceId: 'mic-usb',
      label: 'USB Mic'
    }]

    // Trigger onDeviceChange with USB mic unplugged (leaving default mic)
    globalThis.navigator.mediaDevices.enumerateDevices = async () => [
      {
        kind: 'audioinput',
        deviceId: 'default',
        label: 'Default Mic'
      }
    ]

    const deviceChange = env.getDeviceChangeHandler()
    assert.ok(deviceChange)
    await deviceChange()

    assert.strictEqual(env.localState.activeMicId, 'default', 'Must fall back to default microphone')
    const infoToast = env.toasts.find(t => t.message.includes('Microphone disconnected. Switched to default microphone.'))
    assert.ok(infoToast)
    assert.strictEqual(infoToast.variant, 'info')
  })

  await t.test('5. Mid-Call Microphone Total Loss -> replaceTrack(null) & call:device_lost', async () => {
    const env = setupTestEnvironment()
    const oldAudioTrack = createMockTrack('audio')
    env.globalState.localStream = createMockStream([oldAudioTrack])
    env.localState.activeMicId = 'mic-usb'
    env.localState.microphones = [{
      deviceId: 'mic-usb',
      label: 'USB Mic'
    }]

    // Trigger onDeviceChange with all mics unplugged and GUM fallback failing
    globalThis.navigator.mediaDevices.enumerateDevices = async () => []
    globalThis.navigator.mediaDevices.getUserMedia = async () => {
      const err = new Error('No devices')
      err.name = 'NotFoundError'
      throw err
    }

    let nullReplaceCalled = false
    env.audioSender.replaceTrack = async (track) => {
      if (track === null) {
        nullReplaceCalled = true
      }
    }

    const deviceChange = env.getDeviceChangeHandler()
    await deviceChange()

    assert.strictEqual(nullReplaceCalled, true, 'replaceTrack(null) must be called on total mic loss')
    assert.strictEqual(env.localState.isAudioEnabled, false, 'Local audio state must be muted')

    const dangerToast = env.toasts.find(t => t.message === 'Microphone disconnected.')
    assert.ok(dangerToast)
    assert.strictEqual(dangerToast.variant, 'danger')

    const deviceLostEvent = env.busEvents.find(e => e.event === 'call:device_lost')
    assert.ok(deviceLostEvent)
    assert.strictEqual(deviceLostEvent.payload.kind, 'audio')
    assert.strictEqual(deviceLostEvent.payload.deviceId, 'mic-usb')
  })

  await t.test('6. Mid-Call Speaker Loss -> Reset setSinkId & call:device_lost', async () => {
    const env = setupTestEnvironment()
    env.localState.activeSpeakerId = 'speaker-ext'
    env.localState.speakers = [{
      deviceId: 'speaker-ext',
      label: 'External Speaker'
    }]

    globalThis.navigator.mediaDevices.enumerateDevices = async () => []

    let sinkIdSetToEmpty = false
    const mockVideoEl = {
      setSinkId: async (id) => {
        if (id === '') {
          sinkIdSetToEmpty = true
        }
      }
    }
    globalThis.document.querySelectorAll = (selector) => {
      if (selector.includes('video')) {
        return [mockVideoEl]
      }
      return []
    }

    const deviceChange = env.getDeviceChangeHandler()
    await deviceChange()

    assert.strictEqual(env.localState.activeSpeakerId, 'default', 'Speaker ID must reset to default')
    assert.strictEqual(sinkIdSetToEmpty, true, 'setSinkId("") must be called on remote videos')

    const infoToast = env.toasts.find(t => t.message.includes('Speaker disconnected.'))
    assert.ok(infoToast)

    const deviceLostEvent = env.busEvents.find(e => e.event === 'call:device_lost')
    assert.ok(deviceLostEvent)
    assert.strictEqual(deviceLostEvent.payload.kind, 'speaker')
    assert.strictEqual(deviceLostEvent.payload.deviceId, 'speaker-ext')
  })

  await t.test('7. Idle Device Change -> Silent Re-enumeration without Toasts', async () => {
    const env = setupTestEnvironment()
    env.localState.callStatus = 'idle'
    env.globalState.callStatus = 'idle'

    const deviceChange = env.getDeviceChangeHandler()
    await deviceChange()

    assert.strictEqual(env.toasts.length, 0, 'No toasts should be presented when device changes while idle')
    const deviceLostEvent = env.busEvents.find(e => e.event === 'call:device_lost')
    assert.strictEqual(deviceLostEvent, undefined, 'No call:device_lost event should be emitted while idle')
  })
})
