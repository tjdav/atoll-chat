import { test } from 'node:test'
import assert from 'node:assert'
import webrtcPlugin from '../../src/plugins/web-rtc-plugin.js'

// Mock global WebRTC primitives for Node unit tests
if (typeof globalThis.RTCPeerConnection === 'undefined') {
  globalThis.RTCPeerConnection = class MockRTCPeerConnection {
    constructor () {
      this.signalingState = 'stable'
      this.connectionState = 'connected'
      this.iceConnectionState = 'connected'
      this.iceGatheringState = 'new'
      this.senders = []
      this.receivers = []
      this.oniceconnectionstatechange = null
      this.onconnectionstatechange = null
      this.onicegatheringstatechange = null
      this.onicecandidate = null
      this.ontrack = null
    }

    addTrack (track) {
      this.senders.push({ track })
    }

    getSenders () {
      return this.senders
    }

    getReceivers () {
      return this.receivers
    }

    close () {
    }

    restartIce () {
      this.iceRestarted = true
    }

    async createOffer (options) {
      this.signalingState = 'have-local-offer'
      return {
        type: 'offer',
        sdp: options?.iceRestart ? 'mock-renegotiation-sdp' : 'mock-offer-sdp'
      }
    }

    async createAnswer () {
      return {
        type: 'answer',
        sdp: 'mock-answer-sdp'
      }
    }

    async setLocalDescription (desc) {
      this.localDescription = desc
    }

    async setRemoteDescription (desc) {
      this.remoteDescription = desc
      if (desc.type === 'offer') {
        this.signalingState = 'have-remote-offer'
      }
    }

    async addIceCandidate () {
    }
  }
}

if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis
}

if (typeof globalThis.RTCIceCandidate === 'undefined') {
  globalThis.RTCIceCandidate = class MockRTCIceCandidate {
    constructor (candidate) {
      this.candidate = candidate
    }

    toJSON () {
      return { candidate: this.candidate }
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
    emit (event, payload) {
      const cbs = listeners.get(event) || []
      for (const cb of cbs) {
        cb(payload)
      }
    }
  }

  const globalStore = {
    $state: {
      callStatus: 'idle',
      activeCallId: null,
      activeCallRoomId: null,
      currentUser: { id: 'user-alice' },
      isCatchingUp: false,
      isVideoEnabled: true,
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

test('WebRTC Failure Recovery & Candidate Flushing Tests', async (t) => {
  await t.test('1. Explicit Connection Failure Signaling - sends call_end with connection_failed on pc failure', async () => {
    const env = createMockEnvironment()
    const mockTrack = {
      stop: () => {
      }
    }
    const mockStream = {
      getVideoTracks: () => [],
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    }

    await env.webrtc.initiateCall('room-1', mockStream)
    const pc = window.__E2E_PEER_CONNECTION__
    assert.ok(pc)

    let endedPayload = null
    env.bus.on('call:ended', (payload) => {
      endedPayload = payload
    })

    // Simulate pc.connectionState === 'failed'
    pc.connectionState = 'failed'
    await pc.onconnectionstatechange()

    const endExecution = env.workerExecutions.find(e => e.payload.type === 'call_end' && e.payload.reason === 'connection_failed')
    assert.ok(endExecution, 'call_end message with reason connection_failed must be sent')
    assert.ok(endedPayload)
    assert.strictEqual(endedPayload.reason, 'connection_failed')
    assert.strictEqual(env.globalState.callStatus, 'idle')
  })

  await t.test('2. ICE Disconnection & Grace Timer / Offerer Restart', async () => {
    const env = createMockEnvironment()
    const mockTrack = {
      stop: () => {
      }
    }
    const mockStream = {
      getVideoTracks: () => [],
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    }

    await env.webrtc.initiateCall('room-1', mockStream)
    const pc = window.__E2E_PEER_CONNECTION__

    let reconnectingFired = false
    let reconnectedFired = false
    env.bus.on('call:reconnecting', () => {
      reconnectingFired = true
    })
    env.bus.on('call:reconnected', () => {
      reconnectedFired = true
    })

    // Trigger ICE disconnected
    pc.iceConnectionState = 'disconnected'
    await pc.oniceconnectionstatechange()

    assert.strictEqual(reconnectingFired, true, 'call:reconnecting event should fire')
    assert.strictEqual(pc.iceRestarted, true, 'Offerer should call restartIce()')

    const renegotiationOffer = env.workerExecutions.filter(e => e.payload.type === 'call_offer')[1]
    assert.ok(renegotiationOffer, 'Renegotiation offer should be sent')
    assert.strictEqual(renegotiationOffer.payload.content.sdp, 'mock-renegotiation-sdp')

    // Simulate ICE connected restoration
    pc.iceConnectionState = 'connected'
    await pc.oniceconnectionstatechange()

    assert.strictEqual(reconnectedFired, true, 'call:reconnected event should fire on recovery')
  })

  await t.test('3. Answerer renegotiation offer handling', async () => {
    const env = createMockEnvironment()
    const mockTrack = {
      stop: () => {
      }
    }
    const mockStream = {
      getVideoTracks: () => [],
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    }

    const callId = 'renegotiation-session-1'
    // First deliver incoming call_offer to set state to INCOMING
    env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: {
        type: 'call_offer',
        call_id: callId,
        sender_id: 'user-bob',
        content: {
          type: 'offer',
          sdp: 'sdp-1'
        }
      }
    })

    // Answer incoming call
    await env.webrtc.answerCall('room-1', mockStream, {
      type: 'offer',
      sdp: 'sdp-1'
    }, callId)
    assert.strictEqual(env.globalState.callStatus, 'connected')

    // Offerer sends renegotiation offer with same callId
    env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: {
        type: 'call_offer',
        call_id: callId,
        sender_id: 'user-bob',
        content: {
          type: 'offer',
          sdp: 'renegotiation-sdp'
        }
      }
    })

    // Give async task time
    await new Promise(resolve => setTimeout(resolve, 50))

    const answerExecutions = env.workerExecutions.filter(e => e.payload.type === 'call_answer')
    assert.strictEqual(answerExecutions.length, 2, 'Answerer should answer the renegotiation offer')
    assert.strictEqual(answerExecutions[1].payload.call_id, callId)
  })

  await t.test('4. 12s Grace Timer Expiry terminates call with timeout_disconnected', async () => {
    const env = createMockEnvironment()
    const mockTrack = {
      stop: () => {
      }
    }
    const mockStream = {
      getVideoTracks: () => [],
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    }

    await env.webrtc.initiateCall('room-1', mockStream)
    const pc = window.__E2E_PEER_CONNECTION__

    // Override setTimeout to run immediately for testing
    const origSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = (fn, delay) => {
      if (delay === 12000) {
        fn()
        return 999
      }
      return origSetTimeout(fn, delay)
    }

    try {
      let endedPayload = null
      env.bus.on('call:ended', (payload) => {
        endedPayload = payload
      })

      pc.iceConnectionState = 'disconnected'
      await pc.oniceconnectionstatechange()

      const endExecution = env.workerExecutions.find(e => e.payload.type === 'call_end' && e.payload.reason === 'timeout_disconnected')
      assert.ok(endExecution, 'call_end with timeout_disconnected should be dispatched')
      assert.strictEqual(endedPayload.reason, 'timeout_disconnected')
      assert.strictEqual(env.globalState.callStatus, 'idle')
    } finally {
      globalThis.setTimeout = origSetTimeout
    }
  })

  await t.test('5. Session-guarded and awaited candidate flush', async () => {
    const env = createMockEnvironment()
    const mockTrack = {
      stop: () => {
      }
    }
    const mockStream = {
      getVideoTracks: () => [],
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    }

    await env.webrtc.initiateCall('room-1', mockStream)
    const pc = window.__E2E_PEER_CONNECTION__

    // Candidate 1
    await pc.onicecandidate({ candidate: new globalThis.RTCIceCandidate({ candidate: 'cand1' }) })

    // End of trickle candidates (null)
    await pc.onicecandidate({ candidate: null })

    const candidateExecutions = env.workerExecutions.filter(e => e.payload.type === 'ice_candidate')
    assert.ok(candidateExecutions.length >= 1, 'Candidates should be flushed on null candidate')
    assert.deepStrictEqual(candidateExecutions[0].payload.candidates, [{ candidate: { candidate: 'cand1' } }])

    // iceGatheringState complete
    await pc.onicecandidate({ candidate: new globalThis.RTCIceCandidate({ candidate: 'cand2' }) })
    pc.iceGatheringState = 'complete'
    await pc.onicegatheringstatechange()

    const candidateExecutions2 = env.workerExecutions.filter(e => e.payload.type === 'ice_candidate')
    assert.strictEqual(candidateExecutions2.length, 2, 'Candidates should be flushed on iceGatheringState complete')
  })
})
