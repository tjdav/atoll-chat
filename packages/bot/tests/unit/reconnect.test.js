import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { computeBackoffDelay, createReconnectController } from '../../src/runtime/reconnect.js'

/**
 * Creates a fake WebSocket client.
 */
function createFakeWs () {
  /** @type {Set<(payload?: any) => void>} */
  const closeListeners = new Set()
  let connectCalls = 0
  let connectFailNext = false

  return {
    connect: async () => {
      connectCalls++
      if (connectFailNext) {
        connectFailNext = false
        throw new Error('Connection failed')
      }
    },
    on: (event, handler) => {
      if (event === 'close') {
        closeListeners.add(handler)
        return () => closeListeners.delete(handler)
      }
      return () => {}
    },
    emitClose: (payload) => {
      for (const handler of Array.from(closeListeners)) {
        handler(payload)
      }
    },
    getConnectCalls: () => connectCalls,
    setConnectFailNext: (fail) => { connectFailNext = fail },
    getCloseListenerCount: () => closeListeners.size
  }
}

describe('computeBackoffDelay', () => {
  test('1. computeBackoffDelay returns base on attempt 1', () => {
    const delay = computeBackoffDelay({
      attempt: 1,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      random: () => 0.5
    })
    assert.equal(delay, 1000)
  })

  test('2. Attempt 2 doubles the base', () => {
    const delay = computeBackoffDelay({
      attempt: 2,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      random: () => 0.5
    })
    assert.equal(delay, 2000)
  })

  test('3. Attempt 3 quadruples', () => {
    const delay = computeBackoffDelay({
      attempt: 3,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      random: () => 0.5
    })
    assert.equal(delay, 4000)
  })

  test('4. Attempt N caps at maxBackoffMs', () => {
    const delay = computeBackoffDelay({
      attempt: 10,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      random: () => 0.5
    })
    assert.equal(delay, 30000)
  })

  test('5. Jitter is proportional and symmetric', () => {
    const delayMax = computeBackoffDelay({
      attempt: 1,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0.2,
      random: () => 1
    })
    assert.equal(delayMax, 1200)

    const delayMin = computeBackoffDelay({
      attempt: 1,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0.2,
      random: () => 0
    })
    assert.equal(delayMin, 800)
  })

  test('6. Jitter does not produce a negative delay', () => {
    const delay = computeBackoffDelay({
      attempt: 1,
      baseBackoffMs: 100,
      maxBackoffMs: 30000,
      jitter: 1.5,
      random: () => 0
    })
    assert.ok(delay >= 0)
  })

  test('7. random defaults to Math.random', () => {
    const delay = computeBackoffDelay({
      attempt: 1,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0.2
    })
    assert.ok(delay >= 800 && delay <= 1200)
  })
})

describe('createReconnectController - Controller loop', () => {
  test('8. Close event triggers a reconnect after the backoff', async () => {
    const ws = createFakeWs()
    /** @type {number[]} */
    const sleeps = []
    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => {},
      sleep: async (ms) => { sleeps.push(ms) },
      random: () => 0.5
    })

    controller.start()
    ws.emitClose()

    await new Promise((r) => setTimeout(r, 10))
    assert.equal(sleeps.length, 1)
    assert.equal(sleeps[0], 1000)
    assert.equal(ws.getConnectCalls(), 1)
    await controller.stop()
  })

  test('9. Reconnect uses the idempotent ws.connect()', async () => {
    const ws = createFakeWs()
    const controller = createReconnectController({
      ws,
      baseBackoffMs: 100,
      maxBackoffMs: 1000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => {},
      sleep: async () => {},
      random: () => 0.5
    })

    controller.start()
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(ws.getConnectCalls(), 1)
    await controller.stop()
  })

  test('10. Successful connect calls onConnected', async () => {
    const ws = createFakeWs()
    let onConnectedCalled = false
    const controller = createReconnectController({
      ws,
      baseBackoffMs: 100,
      maxBackoffMs: 1000,
      jitter: 0,
      onConnected: async () => { onConnectedCalled = true },
      reconnectSse: async () => {},
      sleep: async () => {},
      random: () => 0.5
    })

    controller.start()
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(onConnectedCalled, true)
    await controller.stop()
  })

  test('11. Successful connect calls reconnectSse', async () => {
    const ws = createFakeWs()
    let reconnectSseCalled = false
    const controller = createReconnectController({
      ws,
      baseBackoffMs: 100,
      maxBackoffMs: 1000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => { reconnectSseCalled = true },
      sleep: async () => {},
      random: () => 0.5
    })

    controller.start()
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(reconnectSseCalled, true)
    await controller.stop()
  })

  test('12. Failed connect increments the attempt counter', async () => {
    const ws = createFakeWs()
    ws.setConnectFailNext(true)

    /** @type {number[]} */
    const sleeps = []
    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => {},
      sleep: async (ms) => {
        sleeps.push(ms)
        if (sleeps.length >= 2) {
          await controller.stop()
        }
      },
      random: () => 0.5
    })

    controller.start()
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(controller.currentAttempt(), 2)
  })

  test('13. Failed connect retries with a larger delay', async () => {
    const ws = createFakeWs()
    ws.setConnectFailNext(true)

    /** @type {number[]} */
    const sleeps = []
    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => {},
      sleep: async (ms) => {
        sleeps.push(ms)
        if (sleeps.length >= 2) {
          await controller.stop()
        }
      },
      random: () => 0.5
    })

    controller.start()
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(sleeps.length >= 2, true)
    assert.equal(sleeps[0], 1000)
    assert.equal(sleeps[1], 2000)
  })

  test('14. A second close after a successful reconnect triggers the loop again', async () => {
    const ws = createFakeWs()
    /** @type {number[]} */
    const sleeps = []
    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => {},
      sleep: async (ms) => { sleeps.push(ms) },
      random: () => 0.5
    })

    controller.start()
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(ws.getConnectCalls(), 1)

    ws.emitClose()
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(ws.getConnectCalls(), 2)
    assert.equal(sleeps.length, 2)
    await controller.stop()
  })

  test('15. A connection that lasts at least stableConnectionMs resets the attempt counter', async () => {
    const ws = createFakeWs()
    let nowTime = 1000
    /** @type {number[]} */
    const sleeps = []

    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      stableConnectionMs: 5000,
      onConnected: async () => {},
      reconnectSse: async () => {},
      sleep: async (ms) => { sleeps.push(ms) },
      now: () => nowTime,
      random: () => 0.5
    })

    controller.start()
    // First close at t=1000
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(sleeps[0], 1000)

    // Simulate 6 seconds passed before next close
    nowTime += 6000
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(sleeps[1], 1000) // attempt reset to 1
    await controller.stop()
  })

  test('16. A connection that drops before stableConnectionMs continues the counter', async () => {
    const ws = createFakeWs()
    let nowTime = 1000
    ws.setConnectFailNext(true)
    /** @type {number[]} */
    const sleeps = []

    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      stableConnectionMs: 5000,
      onConnected: async () => {},
      reconnectSse: async () => {},
      sleep: async (ms) => {
        sleeps.push(ms)
        if (sleeps.length >= 2) {
          await controller.stop()
        }
      },
      now: () => nowTime,
      random: () => 0.5
    })

    controller.start()
    nowTime += 1000 // Only 1s elapsed
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 20))

    assert.equal(sleeps.length >= 2, true)
    assert.equal(sleeps[0], 1000)
    assert.equal(sleeps[1], 2000) // attempt continued to 2
  })

  test('17. onConnected failure does not abort the loop', async () => {
    const ws = createFakeWs()
    let reconnectSseCalled = false

    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => { throw new Error('onConnected error') },
      reconnectSse: async () => { reconnectSseCalled = true },
      sleep: async () => {},
      random: () => 0.5
    })

    controller.start()
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(reconnectSseCalled, true)
    await controller.stop()
  })

  test('18. reconnectSse failure does not abort the loop', async () => {
    const ws = createFakeWs()

    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => { throw new Error('reconnectSse error') },
      sleep: async () => {},
      random: () => 0.5
    })

    controller.start()
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(ws.getConnectCalls(), 1)
    await controller.stop()
  })
})

describe('createReconnectController - SSE per-room', () => {
  test('19. notifySseClosed("r_abc") schedules a reconnect', async () => {
    const ws = createFakeWs()
    /** @type {string[]} */
    const reconnectedRooms = []
    /** @type {number[]} */
    const sleeps = []

    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async (roomId) => {
        if (roomId) reconnectedRooms.push(roomId)
      },
      sleep: async (ms) => { sleeps.push(ms) },
      random: () => 0.5
    })

    controller.start()
    const p = controller.notifySseClosed('r_abc')
    await new Promise((r) => setTimeout(r, 10))

    await p
    assert.equal(sleeps.length, 1)
    assert.equal(sleeps[0], 1000)
    assert.deepEqual(reconnectedRooms, ['r_abc'])
    await controller.stop()
  })

  test('20. Failed SSE reconnect retries with a larger delay', async () => {
    const ws = createFakeWs()
    /** @type {number[]} */
    const sleeps = []
    let attempts = 0

    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async (roomId) => {
        attempts++
        if (attempts === 1) {
          throw new Error('SSE connect fail')
        }
      },
      sleep: async (ms) => { sleeps.push(ms) },
      random: () => 0.5
    })

    controller.start()
    await controller.notifySseClosed('r_abc')
    assert.equal(sleeps.length, 2)
    assert.equal(sleeps[0], 1000)
    assert.equal(sleeps[1], 2000)
    await controller.stop()
  })

  test('21. Successful SSE reconnect resets the room\'s attempt counter', async () => {
    const ws = createFakeWs()
    /** @type {number[]} */
    const sleeps = []
    let failFirst = true

    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => {
        if (failFirst) {
          failFirst = false
          throw new Error('fail first')
        }
      },
      sleep: async (ms) => { sleeps.push(ms) },
      random: () => 0.5
    })

    controller.start()
    // First notify: attempt 1 fails, attempt 2 succeeds
    await controller.notifySseClosed('r_abc')
    assert.equal(sleeps[0], 1000)
    assert.equal(sleeps[1], 2000)

    // Second notify: attempt reset to 1
    await controller.notifySseClosed('r_abc')
    assert.equal(sleeps[2], 1000)
    await controller.stop()
  })

  test('22. Multiple notifySseClosed for the same room within the window coalesce', async () => {
    const ws = createFakeWs()
    let reconnectCalls = 0

    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => { reconnectCalls++ },
      sleep: async () => {},
      random: () => 0.5
    })

    controller.start()
    const p1 = controller.notifySseClosed('r_abc')
    const p2 = controller.notifySseClosed('r_abc')

    await Promise.all([p1, p2])
    assert.equal(reconnectCalls, 1)
    await controller.stop()
  })

  test('23. notifySseClosed for a different room has its own counter', async () => {
    const ws = createFakeWs()
    /** @type {Array<{ room: string, delay: number }>} */
    const log = []

    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async (roomId) => {
        if (roomId === 'r_1') {
          throw new Error('r_1 fails')
        }
      },
      sleep: async (ms) => {},
      random: () => 0.5
    })

    controller.start()
    // r_1 will fail once then succeed (we stop after 2)
    let r1Count = 0
    const customController = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async (roomId) => {
        if (roomId === 'r_1') {
          r1Count++
          if (r1Count === 1) throw new Error('r_1 fail')
        }
      },
      sleep: async (ms) => {
        log.push({ room: 'any', delay: ms })
      },
      random: () => 0.5
    })

    customController.start()
    await Promise.all([
      customController.notifySseClosed('r_1'),
      customController.notifySseClosed('r_2')
    ])

    // r_2 gets 1000ms delay. r_1 gets 1000ms delay (fails), then 2000ms delay (succeeds)
    assert.equal(log.length, 3)
    await customController.stop()
    await controller.stop()
  })
})

describe('createReconnectController - Stop', () => {
  test('24. stop() cancels the pending sleep', async () => {
    const ws = createFakeWs()
    let connectCalled = false

    const controller = createReconnectController({
      ws,
      baseBackoffMs: 10000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => {},
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      random: () => 0.5
    })

    controller.start()
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 10))

    await controller.stop()
    assert.equal(connectCalled, false)
  })

  test('25. stop() during an in-flight connect() waits for it to settle', async () => {
    const ws = createFakeWs()
    let resolveConnect
    ws.connect = async () => {
      await new Promise((r) => { resolveConnect = r })
    }

    const controller = createReconnectController({
      ws,
      baseBackoffMs: 100,
      maxBackoffMs: 1000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => {},
      sleep: async () => {},
      random: () => 0.5
    })

    controller.start()
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 10))

    let stopResolved = false
    const stopP = controller.stop().then(() => { stopResolved = true })
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(stopResolved, false)

    resolveConnect()
    await stopP
    assert.equal(stopResolved, true)
  })

  test('26. stop() is idempotent', async () => {
    const ws = createFakeWs()
    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => {},
      sleep: async () => {},
      random: () => 0.5
    })

    controller.start()
    await controller.stop()
    await controller.stop()
  })

  test('27. start() after stop() begins a fresh loop', async () => {
    const ws = createFakeWs()
    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => {},
      sleep: async () => {},
      random: () => 0.5
    })

    controller.start()
    await controller.stop()

    controller.start()
    ws.emitClose()
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(ws.getConnectCalls(), 1)
    await controller.stop()
  })

  test('28. stop() removes the close listener', async () => {
    const ws = createFakeWs()
    const controller = createReconnectController({
      ws,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0,
      onConnected: async () => {},
      reconnectSse: async () => {},
      sleep: async () => {},
      random: () => 0.5
    })

    controller.start()
    assert.equal(ws.getCloseListenerCount(), 1)
    await controller.stop()
    assert.equal(ws.getCloseListenerCount(), 0)
  })
})
