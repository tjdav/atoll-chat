// @ts-nocheck
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  createShutdownTracker,
  installSignalHandlers,
  runShutdownSequence
} from '../../src/runtime/shutdown.js'

describe('createShutdownTracker unit tests', () => {
  test('1. track(fn) runs fn and returns its value', async () => {
    const tracker = createShutdownTracker()
    const result = await tracker.track(async () => 'hello')
    assert.equal(result, 'hello')
  })

  test('2. track(fn) rejects with fn rejection', async () => {
    const tracker = createShutdownTracker()
    await assert.rejects(
      async () => {
        await tracker.track(async () => {
          throw new Error('boom')
        })
      },
      { message: 'boom' }
    )
  })

  test('3. inFlightCount() is 0 initially', () => {
    const tracker = createShutdownTracker()
    assert.equal(tracker.inFlightCount(), 0)
  })

  test('4. inFlightCount() reflects active operations', async () => {
    const tracker = createShutdownTracker()
    let resolve
    const promise = new Promise((r) => { resolve = r })

    const trackPromise = tracker.track(() => promise)
    assert.equal(tracker.inFlightCount(), 1)

    resolve('done')
    await trackPromise
  })

  test('5. inFlightCount() returns to 0 after operations settle', async () => {
    const tracker = createShutdownTracker()
    await tracker.track(async () => 123)
    assert.equal(tracker.inFlightCount(), 0)
  })

  test('6. waitForAll(0) returns immediately with current count', async () => {
    const tracker = createShutdownTracker()
    let resolve
    const p = tracker.track(() => new Promise((r) => { resolve = r }))

    const result = await tracker.waitForAll(0)
    assert.deepEqual(result, { drained: false, remaining: 1 })

    resolve()
    await p
  })

  test('7. waitForAll(ms) returns { drained: true, remaining: 0 } when all complete', async () => {
    const tracker = createShutdownTracker()
    tracker.track(() => new Promise((r) => setTimeout(r, 20)))

    const result = await tracker.waitForAll(100)
    assert.deepEqual(result, { drained: true, remaining: 0 })
  })

  test('8. waitForAll(ms) returns { drained: false, remaining: N } on timeout', async () => {
    const tracker = createShutdownTracker()
    let resolve
    const p = tracker.track(() => new Promise((r) => { resolve = r }))

    const result = await tracker.waitForAll(20)
    assert.deepEqual(result, { drained: false, remaining: 1 })

    resolve()
    await p
  })

  test('9. isShuttingDown() is false initially', () => {
    const tracker = createShutdownTracker()
    assert.equal(tracker.isShuttingDown(), false)
  })

  test('10. startShutdown() sets the flag and second call is a no-op', () => {
    const tracker = createShutdownTracker()
    tracker.startShutdown()
    assert.equal(tracker.isShuttingDown(), true)
    tracker.startShutdown()
    assert.equal(tracker.isShuttingDown(), true)
  })

  test('11. track after startShutdown still tracks', async () => {
    const tracker = createShutdownTracker()
    tracker.startShutdown()
    const val = await tracker.track(async () => 'ok')
    assert.equal(val, 'ok')
  })

  test('12. Multiple concurrent track calls all tracked', async () => {
    const tracker = createShutdownTracker()
    let resolve1, resolve2
    const p1 = tracker.track(() => new Promise((r) => { resolve1 = r }))
    const p2 = tracker.track(() => new Promise((r) => { resolve2 = r }))

    assert.equal(tracker.inFlightCount(), 2)

    resolve1()
    await p1
    assert.equal(tracker.inFlightCount(), 1)

    resolve2()
    await p2
    assert.equal(tracker.inFlightCount(), 0)
  })
})

describe('installSignalHandlers unit tests', () => {
  test('13. SIGTERM triggers onSignal once', async () => {
    let calls = 0
    const cleanup = installSignalHandlers({
      onSignal: async () => { calls++ }
    })

    try {
      process.emit('SIGTERM')
      await new Promise((r) => setTimeout(r, 10))
      assert.equal(calls, 1)
    } finally {
      cleanup()
    }
  })

  test('14. SIGINT triggers onSignal once', async () => {
    let calls = 0
    const cleanup = installSignalHandlers({
      onSignal: async () => { calls++ }
    })

    try {
      process.emit('SIGINT')
      await new Promise((r) => setTimeout(r, 10))
      assert.equal(calls, 1)
    } finally {
      cleanup()
    }
  })

  test('15. A second signal during handling is ignored', async () => {
    let calls = 0
    let resolveSignal
    const cleanup = installSignalHandlers({
      onSignal: async () => {
        calls++
        await new Promise((r) => { resolveSignal = r })
      }
    })

    try {
      process.emit('SIGTERM')
      await new Promise((r) => setTimeout(r, 10))
      process.emit('SIGINT')
      await new Promise((r) => setTimeout(r, 10))

      assert.equal(calls, 1)
      resolveSignal()
    } finally {
      cleanup()
    }
  })

  test('16. onSignal rejection is logged and swallowed', async () => {
    const logged = []
    const logger = {
      info: () => {},
      warn: () => {},
      error: (msg, meta) => logged.push({ msg, meta })
    }

    const cleanup = installSignalHandlers({
      onSignal: async () => {
        throw new Error('signal fail')
      },
      logger
    })

    try {
      process.emit('SIGTERM')
      await new Promise((r) => setTimeout(r, 10))

      assert.equal(logged.length, 1)
      assert.equal(logged[0].msg, 'shutdown: handler failed')
      assert.equal(logged[0].meta.meta.error, 'signal fail')
    } finally {
      cleanup()
    }
  })

  test('17. Cleanup removes the handlers', async () => {
    let calls = 0
    const cleanup = installSignalHandlers({
      onSignal: async () => { calls++ }
    })

    cleanup()
    process.emit('SIGTERM')
    await new Promise((r) => setTimeout(r, 10))

    assert.equal(calls, 0)
  })
})

describe('runShutdownSequence unit tests', () => {
  test('18. Returns 0 when runtime.stop resolves drained: true', async () => {
    const runtime = {
      stop: async () => ({ drained: true, remaining: 0 })
    }
    const code = await runShutdownSequence({ runtime, drainMs: 100 })
    assert.equal(code, 0)
  })

  test('19. Returns 1 when runtime.stop resolves drained: false', async () => {
    const runtime = {
      stop: async () => ({ drained: false, remaining: 2 })
    }
    const code = await runShutdownSequence({ runtime, drainMs: 100 })
    assert.equal(code, 1)
  })

  test('20. Returns 1 when runtime.stop rejects', async () => {
    const runtime = {
      stop: async () => { throw new Error('stop crashed') }
    }
    const code = await runShutdownSequence({ runtime, drainMs: 100 })
    assert.equal(code, 1)
  })

  test('21. Logs shutdown: starting and shutdown: complete on success', async () => {
    const logs = []
    const logger = {
      info: (msg, meta) => logs.push({ type: 'info', msg, meta }),
      warn: (msg, meta) => logs.push({ type: 'warn', msg, meta }),
      error: (msg, meta) => logs.push({ type: 'error', msg, meta })
    }
    const runtime = {
      stop: async () => ({ drained: true, remaining: 0 })
    }

    const code = await runShutdownSequence({ runtime, drainMs: 500, logger })
    assert.equal(code, 0)
    assert.equal(logs.length, 2)
    assert.equal(logs[0].msg, 'shutdown: starting')
    assert.equal(logs[1].msg, 'shutdown: complete')
  })

  test('22. Logs shutdown: drain timeout on drain failure', async () => {
    const logs = []
    const logger = {
      info: (msg, meta) => logs.push({ type: 'info', msg, meta }),
      warn: (msg, meta) => logs.push({ type: 'warn', msg, meta }),
      error: (msg, meta) => logs.push({ type: 'error', msg, meta })
    }
    const runtime = {
      stop: async () => ({ drained: false, remaining: 3 })
    }

    const code = await runShutdownSequence({ runtime, drainMs: 500, logger })
    assert.equal(code, 1)
    assert.equal(logs[0].msg, 'shutdown: starting')
    assert.equal(logs[1].msg, 'shutdown: drain timeout')
    assert.equal(logs[1].meta.meta.remaining, 3)
  })
})
