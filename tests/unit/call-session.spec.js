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

    async setLocalDescription (desc) {
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

test('Call Session (call_id) & Stale Signaling Isolation Tests', async (t) => {
  await t.test('1. Universal Envelope Schema Validation - initiateCall, answerCall, endCall generate valid call_id', async () => {
    const env = createMockEnvironment()
    const mockTrack = {
      stop: () => {
      }
    }
    const mockStream = {
      getVideoTracks: () => [mockTrack],
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    }

    // Test initiateCall
    await env.webrtc.initiateCall('room-1', mockStream)
    assert.ok(env.globalState.activeCallId, 'activeCallId should be set on global state')
    assert.strictEqual(env.globalState.activeCallRoomId, 'room-1')

    const offerExecution = env.workerExecutions.find(e => e.payload.type === 'call_offer')
    assert.ok(offerExecution, 'worker:send_message for call_offer should be executed')
    assert.strictEqual(offerExecution.payload.call_id, env.globalState.activeCallId)
    assert.strictEqual(offerExecution.payload.caller_id, 'user-alice')

    // Test answerCall
    const answerCallId = 'session-uuid-123'
    await env.webrtc.answerCall('room-1', mockStream, {
      type: 'offer',
      sdp: 'dummy-sdp'
    }, answerCallId)
    assert.strictEqual(env.globalState.activeCallId, answerCallId)

    const answerExecution = env.workerExecutions.find(e => e.payload.type === 'call_answer')
    assert.ok(answerExecution, 'worker:send_message for call_answer should be executed')
    assert.strictEqual(answerExecution.payload.call_id, answerCallId)

    // Test endCall
    await env.webrtc.endCall('room-1', answerCallId)
    const endExecution = env.workerExecutions.find(e => e.payload.type === 'call_end')
    assert.ok(endExecution, 'worker:send_message for call_end should be executed')
    assert.strictEqual(endExecution.payload.call_id, answerCallId)
  })

  await t.test('2. Stale call_end Isolation - Mismatched call_id is ignored during active call', async () => {
    const env = createMockEnvironment()
    let endedEventEmitted = false
    env.bus.on('call:ended', () => {
      endedEventEmitted = true
    })

    // Establish active call session call-B
    const activeCallId = 'call-session-B'
    env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: {
        type: 'call_offer',
        call_id: activeCallId,
        sender_id: 'user-bob',
        content: {
          type: 'offer',
          sdp: 'sdp'
        }
      }
    })

    assert.strictEqual(env.globalState.activeCallId, activeCallId)

    // Deliver stale call_end from call-session-A
    env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: {
        type: 'call_end',
        call_id: 'call-session-A',
        sender_id: 'user-bob'
      }
    })

    assert.strictEqual(endedEventEmitted, false, 'call:ended event should NOT be emitted for stale call_end')
    assert.strictEqual(env.globalState.activeCallId, activeCallId, 'Active call_id should remain unchanged')
  })

  await t.test('3. Stale call_answer Rejection - Mismatched call_id is dropped', async () => {
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
    const currentCallId = env.globalState.activeCallId

    // Deliver stale call_answer
    env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: {
        type: 'call_answer',
        call_id: 'stale-call-id',
        sender_id: 'user-bob',
        content: {
          type: 'answer',
          sdp: 'sdp-stale'
        }
      }
    })

    assert.strictEqual(env.globalState.activeCallId, currentCallId, 'Active call ID should not be affected by stale answer')
  })

  await t.test('4. Stale ICE Candidate Rejection - Candidates with mismatched call_id are dropped', async () => {
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

    // Deliver ice_candidate for wrong call_id
    env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: {
        type: 'ice_candidate',
        call_id: 'invalid-call-id',
        sender_id: 'user-bob',
        candidates: [{ candidate: 'dummy' }]
      }
    })

    // Should be silently dropped without throwing or changing state
    assert.ok(env.globalState.activeCallId)
  })

  await t.test('5. Auto-Reject Busy Response - Sends call_end reason busy when already in call', async () => {
    const env = createMockEnvironment()
    env.globalState.callStatus = 'connected'
    env.globalState.activeCallId = 'active-call-session-1'

    // Deliver incoming call_offer for new session while busy
    env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: {
        type: 'call_offer',
        call_id: 'incoming-call-session-2',
        sender_id: 'user-charlie',
        content: {
          type: 'offer',
          sdp: 'sdp'
        }
      }
    })

    const busyExecution = env.workerExecutions.find(e => e.payload.type === 'call_end' && e.payload.reason === 'busy')
    assert.ok(busyExecution, 'Worker should execute send_message for auto-reject call_end with reason busy')
    assert.strictEqual(busyExecution.payload.call_id, 'incoming-call-session-2')
    assert.strictEqual(env.globalState.activeCallId, 'active-call-session-1', 'Active call session should remain undisturbed')
  })

  await t.test('6. Strict call_id Enforcement - Discards signaling packets missing call_id', async () => {
    const env = createMockEnvironment()
    let incomingEmitted = false
    env.bus.on('call:incoming', () => {
      incomingEmitted = true
    })

    env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: {
        type: 'call_offer',
        sender_id: 'user-bob',
        content: {
          type: 'offer',
          sdp: 'sdp'
        }
      }
    })

    assert.strictEqual(incomingEmitted, false, 'Packet missing call_id must be discarded')
    assert.strictEqual(env.globalState.activeCallId, null)
  })

  await t.test('7. Catch-Up Queue Reconciliation - Groups by call_id and discards session with call_end', async () => {
    const env = createMockEnvironment()
    env.globalState.isCatchingUp = true

    const now = Date.now()
    const queue = [
      // Session A (has call_end -> should be discarded)
      {
        type: 'call_offer',
        call_id: 'session-A',
        sender_id: 'user-bob',
        timestamp: now,
        content: {}
      },
      {
        type: 'call_end',
        call_id: 'session-A',
        sender_id: 'user-bob',
        timestamp: now
      },
      // Session B (active -> should be processed)
      {
        type: 'call_offer',
        call_id: 'session-B',
        sender_id: 'user-bob',
        timestamp: now,
        content: {}
      },
      {
        type: 'ice_candidate',
        call_id: 'session-B',
        sender_id: 'user-bob',
        timestamp: now,
        candidates: []
      }
    ]

    for (const msg of queue) {
      env.bus.emit('db:new_local_data', {
        room_id: 'room-1',
        message: msg
      })
    }

    env.globalState.isCatchingUp = false
    let incomingCallId = null
    env.bus.on('call:incoming', ({ call_id }) => {
      incomingCallId = call_id
    })

    env.bus.emit('sync:complete')

    assert.strictEqual(incomingCallId, 'session-B', 'Reconciliation should process active session-B and ignore session-A')
    assert.strictEqual(env.globalState.activeCallId, 'session-B')
  })

  await t.test('8. Busy Toast Notification for Caller - Receives reason: busy and shows warning toast', async () => {
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
    const callId = env.globalState.activeCallId

    let toastEmitted = null
    env.bus.on('ui:show_toast', (toast) => {
      toastEmitted = toast
    })

    env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: {
        type: 'call_end',
        call_id: callId,
        sender_id: 'user-bob',
        reason: 'busy'
      }
    })

    assert.ok(toastEmitted, 'Toast event should be emitted')
    assert.strictEqual(toastEmitted.message, 'User is busy on another call')
    assert.strictEqual(toastEmitted.variant, 'warning')
    assert.strictEqual(env.globalState.callStatus, 'idle')
  })

  await t.test('9. In-Flight answerCall Deduplication - Duplicate calls return active promise', async () => {
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

    // First transition to INCOMING via incoming offer
    env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: {
        type: 'call_offer',
        call_id: 'session-dedup',
        sender_id: 'user-bob',
        content: {
          type: 'offer',
          sdp: 'sdp'
        }
      }
    })

    assert.strictEqual(env.globalState.callStatus, 'incoming')

    const offer = {
      type: 'offer',
      sdp: 'sdp'
    }
    const p1 = env.webrtc.answerCall('room-1', mockStream, offer, 'session-dedup')
    const p2 = env.webrtc.answerCall('room-1', mockStream, offer, 'session-dedup')

    assert.strictEqual(p1, p2, 'Concurrent answerCall must return the exact same in-flight Promise')
    await p1
    assert.strictEqual(env.globalState.callStatus, 'connected')

    // Calling answerCall when already CONNECTED resolves immediately without error
    const p3 = env.webrtc.answerCall('room-1', mockStream, offer, 'session-dedup')
    await p3
    assert.strictEqual(env.globalState.callStatus, 'connected')
  })
})
