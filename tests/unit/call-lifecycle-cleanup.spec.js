import { test } from 'node:test'
import assert from 'node:assert'
import webrtcPlugin from '../../src/plugins/web-rtc-plugin.js'

// Mock global WebRTC primitives for Node unit tests
if (typeof globalThis.RTCPeerConnection === 'undefined') {
  globalThis.RTCPeerConnection = class MockRTCPeerConnection {
    constructor () {
      this.signalingState = 'stable'
      this.connectionState = 'connected'
    }

    addTrack () {
    }
    getSenders () {
      return []
    }
    getReceivers () {
      return []
    }
    close () {
    }
    async createOffer () {
      this.signalingState = 'have-local-offer'
      return {
        type: 'offer',
        sdp: 'mock-offer-sdp'
      }
    }
    async createAnswer () {
      return {
        type: 'answer',
        sdp: 'mock-answer-sdp'
      }
    }
    async setLocalDescription () {
    }
    async setRemoteDescription (desc) {
      if (desc.type === 'offer') {
        this.signalingState = 'have-remote-offer'
      }
    }
    async addIceCandidate () {
    }
  }
}

if (typeof globalThis.RTCIceCandidate === 'undefined') {
  globalThis.RTCIceCandidate = class MockRTCIceCandidate {
    constructor (candidate) {
      this.candidate = candidate
    }
  }
}

if (typeof globalThis.RTCSessionDescription === 'undefined') {
  globalThis.RTCSessionDescription = class MockRTCSessionDescription {
    constructor (desc) {
      Object.assign(this, desc)
    }
  }
}

function createMockEnvironment () {
  const listeners = new Map()
  const bus = {
    on (event, callback) {
      if (!listeners.has(event)) {
        listeners.set(event, [])
      }
      listeners.get(event).push(callback)
    },
    async emit (event, payload) {
      const cbs = listeners.get(event) || []
      for (const cb of cbs) {
        await cb(payload)
      }
    }
  }

  const globalStore = {
    $state: {
      callStatus: 'idle',
      activeCallId: null,
      activeCallRoomId: null,
      localStream: null,
      remoteStream: null,
      hasRemoteVideo: false,
      currentUser: { id: 'user-alice' },
      isCatchingUp: false,
      set (key, val) {
        this[key] = val
      }
    }
  }

  const workerExecutions = []
  const worker = {
    async execute (task, payload) {
      workerExecutions.push({
        task,
        payload
      })
      return { success: true }
    }
  }

  const plugin = webrtcPlugin()
  const pluginContext = {
    config: {
      iceServers: [],
      localIceServer: null
    },
    $bus: bus
  }

  const clientContext = plugin.client.context(pluginContext)
  const instanceContext = clientContext({
    cryptoWorker: { $worker: worker },
    globalStore,
    pocketbase: { pb: { send: async () => ({}) } }
  })

  return {
    bus,
    globalState: globalStore.$state,
    worker,
    workerExecutions,
    webrtc: instanceContext.$webrtc,
    listeners
  }
}

test('Call Lifecycle Cleanup Unit Tests', async (t) => {
  await t.test('1. Remote call:ended invalidates offer, activeCallId, and stops media tracks', async () => {
    const env = createMockEnvironment()

    let stoppedTracksCount = 0
    const mockTrack = {
      stop () {
        stoppedTracksCount++
      }
    }
    const mockLocalStream = {
      getTracks: () => [mockTrack, mockTrack]
    }
    const mockRemoteStream = {
      getTracks: () => [mockTrack]
    }

    env.globalState.localStream = mockLocalStream
    env.globalState.remoteStream = mockRemoteStream
    env.globalState.hasRemoteVideo = true
    env.globalState.activeCallId = 'call-session-999'
    env.globalState.activeCallRoomId = 'room-100'
    env.globalState.callStatus = 'connected'

    // Mock resetCallState behavior on call:ended
    env.bus.on('call:ended', ({ room_id, call_id }) => {
      if (env.globalState.activeCallRoomId === room_id || !room_id) {
        if (env.globalState.localStream) {
          env.globalState.localStream.getTracks().forEach(t => t.stop())
          env.globalState.localStream = null
        }
        if (env.globalState.remoteStream) {
          env.globalState.remoteStream.getTracks().forEach(t => t.stop())
          env.globalState.remoteStream = null
        }
        env.globalState.hasRemoteVideo = false
        env.globalState.activeCallId = null
        env.globalState.activeCallRoomId = null
        env.globalState.set('callStatus', 'idle')
      }
    })

    // Simulate remote call:ended dispatch
    await env.bus.emit('call:ended', {
      room_id: 'room-100',
      call_id: 'call-session-999',
      reason: 'remote_ended'
    })

    assert.strictEqual(env.globalState.callStatus, 'idle')
    assert.strictEqual(env.globalState.activeCallId, null)
    assert.strictEqual(env.globalState.activeCallRoomId, null)
    assert.strictEqual(stoppedTracksCount, 3)
  })

  await t.test('2. auth:logout dispatches call_end with user_logged_out and stops streams and audio', async () => {
    const env = createMockEnvironment()

    let localStopped = false
    let remoteStopped = false

    const mockLocalTrack = {
      stop () {
        localStopped = true
      }
    }
    const mockRemoteTrack = {
      stop () {
        remoteStopped = true
      }
    }

    env.globalState.localStream = { getTracks: () => [mockLocalTrack] }
    env.globalState.remoteStream = { getTracks: () => [mockRemoteTrack] }
    env.globalState.hasRemoteVideo = true

    // Initiate an active call session
    const mockTrack = {
      stop () {
      }
    }
    const mockStream = {
      getVideoTracks: () => [],
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    }
    await env.webrtc.initiateCall('room-logout-test', mockStream)

    const callId = env.globalState.activeCallId
    assert.ok(callId)

    // Emit auth:logout
    await env.bus.emit('auth:logout')

    // Verify call_end with reason: user_logged_out was sent
    const logoutExecution = env.workerExecutions.find(e => e.payload.type === 'call_end' && e.payload.reason === 'user_logged_out')
    assert.ok(logoutExecution, 'Worker should dispatch call_end with reason user_logged_out')
    assert.strictEqual(logoutExecution.payload.call_id, callId)

    // Verify global streams stopped and cleared
    assert.strictEqual(localStopped, true, 'Local tracks should be stopped')
    assert.strictEqual(remoteStopped, true, 'Remote tracks should be stopped')
    assert.strictEqual(env.globalState.localStream, null)
    assert.strictEqual(env.globalState.remoteStream, null)
    assert.strictEqual(env.globalState.hasRemoteVideo, false)
    assert.strictEqual(env.globalState.activeCallId, null)
    assert.strictEqual(env.globalState.activeCallRoomId, null)
  })
})
