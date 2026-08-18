import { test } from 'node:test'
import assert from 'node:assert'
import { BoundedTTLDedupe } from '../../src/utils/call/boundedTTLDedupe.js'
import webrtcPlugin from '../../src/plugins/web-rtc-plugin.js'

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

test('BoundedTTLDedupe Unit Tests', async (t) => {
  await t.test('1. BoundedTTLDedupe lazy pruning expires items older than TTL', () => {
    const dedupe = new BoundedTTLDedupe(100, 500)
    const originalNow = Date.now
    let nowTime = 1000
    Date.now = () => nowTime

    try {
      dedupe.add('msg-1')
      nowTime = 1050
      dedupe.add('msg-2')

      assert.strictEqual(dedupe.has('msg-1'), true)
      assert.strictEqual(dedupe.has('msg-2'), true)

      // Fast forward past msg-1 TTL (1000 + 100 = 1100)
      nowTime = 1105
      assert.strictEqual(dedupe.has('msg-1'), false, 'msg-1 should be pruned as expired')
      assert.strictEqual(dedupe.has('msg-2'), true, 'msg-2 should remain active')
      assert.strictEqual(dedupe.size, 1)
    } finally {
      Date.now = originalNow
    }
  })

  await t.test('2. BoundedTTLDedupe FIFO capacity eviction caps map size at maxEntries', () => {
    const dedupe = new BoundedTTLDedupe(60000, 3)
    dedupe.add('msg-1')
    dedupe.add('msg-2')
    dedupe.add('msg-3')
    assert.strictEqual(dedupe.size, 3)

    // Add 4th item, should evict oldest ('msg-1')
    dedupe.add('msg-4')
    assert.strictEqual(dedupe.size, 3)
    assert.strictEqual(dedupe.has('msg-1'), false)
    assert.strictEqual(dedupe.has('msg-2'), true)
    assert.strictEqual(dedupe.has('msg-3'), true)
    assert.strictEqual(dedupe.has('msg-4'), true)
  })

  await t.test('3. BoundedTTLDedupe clear wipes all stored entries', () => {
    const dedupe = new BoundedTTLDedupe(60000, 500)
    dedupe.add('msg-1')
    dedupe.add('msg-2')
    assert.strictEqual(dedupe.size, 2)

    dedupe.clear()
    assert.strictEqual(dedupe.size, 0)
    assert.strictEqual(dedupe.has('msg-1'), false)
    assert.strictEqual(dedupe.has('msg-2'), false)
  })

  await t.test('4. WebRTC plugin ignores duplicate message IDs within TTL window', async () => {
    const env = createMockEnvironment()
    let incomingOffersCount = 0

    env.bus.on('call:incoming', () => {
      incomingOffersCount++
    })

    const msg = {
      id: 'msg-unique-123',
      type: 'call_offer',
      call_id: 'call-1',
      sender_id: 'user-bob',
      content: {
        type: 'offer',
        sdp: 'sdp'
      }
    }

    // Deliver first time
    await env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: msg
    })
    assert.strictEqual(incomingOffersCount, 1)

    // Deliver exact same message ID again
    await env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: msg
    })
    assert.strictEqual(incomingOffersCount, 1, 'Duplicate message ID must be ignored by dedupe store')
  })

  await t.test('5. WebRTC plugin clears dedupe store on auth:logout', async () => {
    const env = createMockEnvironment()
    let incomingOffersCount = 0

    env.bus.on('call:incoming', () => {
      incomingOffersCount++
    })

    const msg = {
      id: 'msg-unique-456',
      type: 'call_offer',
      call_id: 'call-2',
      sender_id: 'user-bob',
      content: {
        type: 'offer',
        sdp: 'sdp'
      }
    }

    await env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: msg
    })
    assert.strictEqual(incomingOffersCount, 1)

    // Emit auth:logout and wait for async teardown completion
    await env.bus.emit('auth:logout')

    // Reset status to idle to receive offer
    env.globalState.callStatus = 'idle'

    // Re-emit message with same ID - since dedupe store was cleared on logout, it should process
    await env.bus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: msg
    })
    assert.strictEqual(incomingOffersCount, 2, 'Cleared dedupe store on logout allows processing message ID')
  })
})
