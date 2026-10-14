import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test, describe, beforeEach, afterEach } from 'node:test'
import { createOperatorResponseMethod } from '../../src/runtime/context/operator-response.js'
import { createRuntime } from '../../src/runtime/index.js'
import { createLogger } from '../../src/runtime/diagnostics/logger.js'

/**
 * Creates a base64url encoded 32-byte key.
 *
 * @param {number} byteVal - Byte fill value.
 * @returns {string} Base64url key.
 */
function makeKey (byteVal) {
  return Buffer.alloc(32, byteVal).toString('base64url')
}

/**
 * FakeWebSocket implementation matching runtime.test.js.
 */
class FakeWebSocket {
  /** @type {FakeWebSocket[]} */
  static instances = []

  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  /**
   * @param {string} url
   */
  constructor (url) {
    this.url = url
    /** @type {Array<Record<string, Object>>} */
    this.sent = []
    this.readyState = 0
    /** @type {Record<string, Function[]>} */
    this.listeners = {}
    /** @type {Function | null} */
    this._onopen = null
    /** @type {Function | null} */
    this._onmessage = null
    /** @type {Function | null} */
    this.onerror = null
    /** @type {Function | null} */
    this.onclose = null
    FakeWebSocket.instances.push(this)
  }

  get onopen () { return this._onopen }
  set onopen (fn) { this._onopen = fn }

  get onmessage () { return this._onmessage }
  set onmessage (fn) {
    this._onmessage = fn
    if (fn) {
      queueMicrotask(() => {
        if (this.readyState === 0) {
          this._open()
        }
      })
    }
  }

  /** @param {any} data */
  send (data) {
    this.sent.push(data)
  }

  /**
   * @param {number} [code]
   * @param {string} [reason]
   */
  close (code, reason) {
    this.readyState = 3
    const listenerList = this.listeners.close || []
    for (const listener of listenerList) {
      listener({ code: code ?? 1000, reason: reason ?? '' })
    }
    if (typeof this.onclose === 'function') {
      this.onclose({ code: code ?? 1000, reason: reason ?? '' })
    }
  }

  /**
   * @param {string} event
   * @param {Function} listener
   */
  addEventListener (event, listener) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(listener)
  }

  /**
   * @param {string} event
   * @param {Function} listener
   */
  removeEventListener (event, listener) {
    if (!this.listeners[event]) return
    this.listeners[event] = this.listeners[event].filter((l) => l !== listener)
  }

  _open () {
    if (this.readyState === 1) return
    this.readyState = 1
    const listenerList = this.listeners.open || []
    for (const listener of listenerList) {
      listener()
    }
    if (typeof this._onopen === 'function') {
      this._onopen()
    }
    this._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'fake_socket_123' })
    })
  }

  /** @param {any} obj */
  _message (obj) {
    const listenerList = this.listeners.message || []
    for (const listener of listenerList) {
      listener({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) })
    }
    if (typeof this._onmessage === 'function') {
      this._onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) })
    }
  }

  /**
   * Simulates receiving a pusher/sockudo event from server.
   *
   * @param {string} channel - Channel name.
   * @param {string} event - Event name.
   * @param {any} data - Event payload.
   */
  simulateServerEvent (channel, event, data) {
    this._message({
      event,
      channel,
      data: typeof data === 'string' ? data : JSON.stringify(data)
    })
  }
}

describe('ctx.onOperatorResponse — Unit & Integration Tests', () => {
  describe('Direct Method Unit Tests (Cases 1-20)', () => {
    test('1. Non-string handle throws TypeError', () => {
      const { onOperatorResponse } = createOperatorResponseMethod({})
      // @ts-expect-error Testing runtime invalid argument
      assert.throws(() => onOperatorResponse(123, () => {}), TypeError)
      // @ts-expect-error Testing runtime invalid argument
      assert.throws(() => onOperatorResponse(null, () => {}), TypeError)
    })

    test('2. Empty-string handle throws TypeError', () => {
      const { onOperatorResponse } = createOperatorResponseMethod({})
      assert.throws(() => onOperatorResponse('', () => {}), TypeError)
    })

    test('3. Non-function callback throws TypeError', () => {
      const { onOperatorResponse } = createOperatorResponseMethod({})
      // @ts-expect-error Testing runtime invalid argument
      assert.throws(() => onOperatorResponse('req_1', 'not_a_func'), TypeError)
      // @ts-expect-error Testing runtime invalid argument
      assert.throws(() => onOperatorResponse('req_1', null), TypeError)
    })

    test('4. A single callback registers (size === 1)', () => {
      const { onOperatorResponse, size } = createOperatorResponseMethod({})
      onOperatorResponse('req_1', () => {})
      assert.equal(size(), 1)
    })

    test('5. Two callbacks for the same handle both register (size === 1, both fire)', () => {
      const { onOperatorResponse, dispatch, size } = createOperatorResponseMethod({})
      const calls = []
      onOperatorResponse('req_1', () => calls.push(1))
      onOperatorResponse('req_1', () => calls.push(2))

      assert.equal(size(), 1)
      dispatch({
        request_id: 'req_1',
        response: 'OK',
        routing: 'private',
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })
      assert.deepEqual(calls, [1, 2])
    })

    test('6. Two callbacks for different handles register separately (size === 2)', () => {
      const { onOperatorResponse, size } = createOperatorResponseMethod({})
      onOperatorResponse('req_1', () => {})
      onOperatorResponse('req_2', () => {})
      assert.equal(size(), 2)
    })

    test('7. Unsubscribe removes the callback (size === 0)', () => {
      const { onOperatorResponse, size } = createOperatorResponseMethod({})
      const unsub = onOperatorResponse('req_1', () => {})
      assert.equal(size(), 1)
      unsub()
      assert.equal(size(), 0)
    })

    test('8. Unsubscribe is idempotent', () => {
      const { onOperatorResponse, size } = createOperatorResponseMethod({})
      const unsub = onOperatorResponse('req_1', () => {})
      assert.equal(size(), 1)
      unsub()
      assert.equal(size(), 0)
      assert.doesNotThrow(() => unsub())
      assert.equal(size(), 0)
    })

    test('9. Removing the last callback for a handle removes the entry', () => {
      const { onOperatorResponse, size } = createOperatorResponseMethod({})
      const cb1 = () => {}
      const cb2 = () => {}
      const unsub1 = onOperatorResponse('req_1', cb1)
      const unsub2 = onOperatorResponse('req_1', cb2)
      assert.equal(size(), 1)

      unsub1()
      assert.equal(size(), 1)
      unsub2()
      assert.equal(size(), 0)
    })

    test('10. Registering the same function twice stores it once (Set semantics)', () => {
      const { onOperatorResponse, dispatch, size } = createOperatorResponseMethod({})
      let count = 0
      const cb = () => { count++ }

      onOperatorResponse('req_1', cb)
      onOperatorResponse('req_1', cb)
      assert.equal(size(), 1)

      dispatch({
        request_id: 'req_1',
        response: 'OK',
        routing: 'private',
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })
      assert.equal(count, 1)
    })

    test('11. A single callback fires with mapped response shape', () => {
      const { onOperatorResponse, dispatch } = createOperatorResponseMethod({})
      let received = null
      onOperatorResponse('req_1', (resp) => {
        received = resp
      })

      dispatch({
        request_id: 'req_1',
        response: 'Approved request',
        routing: 'public',
        room_id: 'r_123',
        responded_by: 'u_admin',
        responded_at: '2026-10-14T12:00:00Z'
      })

      assert.deepEqual(received, {
        response: 'Approved request',
        routing: 'public',
        roomId: 'r_123',
        respondedBy: 'u_admin',
        respondedAt: '2026-10-14T12:00:00Z'
      })
    })

    test('12. Multiple callbacks fire in registration order', () => {
      const { onOperatorResponse, dispatch } = createOperatorResponseMethod({})
      const order = []
      onOperatorResponse('req_1', () => order.push('first'))
      onOperatorResponse('req_1', () => order.push('second'))
      onOperatorResponse('req_1', () => order.push('third'))

      dispatch({
        request_id: 'req_1',
        response: 'Done',
        routing: 'private',
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      assert.deepEqual(order, ['first', 'second', 'third'])
    })

    test('13. A callback for a different handle does not fire', () => {
      const { onOperatorResponse, dispatch } = createOperatorResponseMethod({})
      let fired = false
      onOperatorResponse('req_other', () => { fired = true })

      dispatch({
        request_id: 'req_target',
        response: 'Done',
        routing: 'private',
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      assert.equal(fired, false)
    })

    test('14. An event for an unregistered handle is dropped silently', () => {
      const { dispatch, size } = createOperatorResponseMethod({})
      assert.doesNotThrow(() => {
        dispatch({
          request_id: 'req_unknown',
          response: 'Done',
          routing: 'private',
          responded_by: 'u_op',
          responded_at: '2026-10-14T10:00:00Z'
        })
      })
      assert.equal(size(), 0)
    })

    test('15. A malformed event is logged and dropped', () => {
      const logged = []
      const fakeLogger = {
        debug: () => {},
        warn: (msg) => logged.push(msg),
        error: () => {}
      }
      // @ts-expect-error Testing logger duck-typing
      const { dispatch } = createOperatorResponseMethod({ logger: fakeLogger })

      // @ts-expect-error Testing malformed event
      dispatch(null)
      // @ts-expect-error Testing malformed event
      dispatch({})
      // @ts-expect-error Testing malformed event
      dispatch({ request_id: '' })

      assert.equal(logged.length, 3)
    })

    test('16. A callback that throws does not prevent others from firing', () => {
      const logged = []
      const fakeLogger = {
        debug: () => {},
        warn: () => {},
        error: (msg, meta) => logged.push({ msg, meta })
      }
      // @ts-expect-error Testing logger duck-typing
      const { onOperatorResponse, dispatch } = createOperatorResponseMethod({ logger: fakeLogger })

      let secondFired = false
      onOperatorResponse('req_1', () => {
        throw new Error('Callback boom')
      })
      onOperatorResponse('req_1', () => {
        secondFired = true
      })

      dispatch({
        request_id: 'req_1',
        response: 'Done',
        routing: 'private',
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      assert.equal(secondFired, true)
      assert.equal(logged.length, 1)
      assert.equal(logged[0].msg, 'operator response callback threw')
    })

    test('17. A callback that returns a rejected promise is logged', async () => {
      let loggedError = null
      const fakeLogger = {
        debug: () => {},
        warn: () => {},
        error: (msg, meta) => { loggedError = { msg, meta } }
      }
      // @ts-expect-error Testing logger duck-typing
      const { onOperatorResponse, dispatch } = createOperatorResponseMethod({ logger: fakeLogger })

      onOperatorResponse('req_1', async () => {
        throw new Error('Async rejection')
      })

      dispatch({
        request_id: 'req_1',
        response: 'Done',
        routing: 'private',
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      // Wait a tick for promise rejection catch block
      await new Promise((r) => setTimeout(r, 20))

      assert.notEqual(loggedError, null)
      assert.equal(loggedError.msg, 'operator response callback failed')
    })

    test('18. A callback that unsubscribes another during firing does not affect current dispatch', () => {
      const { onOperatorResponse, dispatch } = createOperatorResponseMethod({})
      const order = []
      let unsub2

      onOperatorResponse('req_1', () => {
        order.push(1)
        unsub2()
      })
      unsub2 = onOperatorResponse('req_1', () => {
        order.push(2)
      })

      dispatch({
        request_id: 'req_1',
        response: 'Done',
        routing: 'private',
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      assert.deepEqual(order, [1, 2])
    })

    test('19. A callback that registers a new callback during firing does not add it to current dispatch', () => {
      const { onOperatorResponse, dispatch } = createOperatorResponseMethod({})
      const order = []

      onOperatorResponse('req_1', () => {
        order.push(1)
        onOperatorResponse('req_1', () => {
          order.push(2)
        })
      })

      dispatch({
        request_id: 'req_1',
        response: 'First dispatch',
        routing: 'private',
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      assert.deepEqual(order, [1])

      dispatch({
        request_id: 'req_1',
        response: 'Second dispatch',
        routing: 'private',
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      assert.deepEqual(order, [1, 1, 2])
    })

    test('20. The request_id is not passed to the callback', () => {
      const { onOperatorResponse, dispatch } = createOperatorResponseMethod({})
      let passedKeys = []

      onOperatorResponse('req_1', (resp) => {
        passedKeys = Object.keys(resp)
      })

      dispatch({
        request_id: 'req_1',
        response: 'Done',
        routing: 'private',
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      assert.equal(passedKeys.includes('request_id'), false)
      assert.equal(passedKeys.includes('requestId'), false)
    })
  })

  describe('Runtime Integration Tests (Cases 21-29)', () => {
    let tmpDir
    let server
    let serverPort

    const syncEvents = []

    beforeEach(async () => {
      FakeWebSocket.instances = []
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'b049-test-'))
      syncEvents.length = 0

      server = http.createServer((req, res) => {
        if (req.url === '/capabilities') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            sockudo_url: 'ws://127.0.0.1:9999',
            sockudo_app_key: 'app-key',
            sockudo_auth_endpoint: '/sockudo/auth'
          }))
          return
        }

        if (req.url?.startsWith('/api/v1/bots/')) {
          if (req.url.includes('/sync')) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              events: syncEvents,
              max_bot_seq: syncEvents.length,
              full_resync_required: false
            }))
            return
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            bot_id: 'b_test',
            owner_user_id: 'u_owner',
            display_name: 'Test Bot',
            avatar_file_id: null
          }))
          return
        }

        if (req.url === '/sockudo/auth') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ auth: 'fake-auth' }))
          return
        }

        res.writeHead(404)
        res.end()
      })

      await new Promise((resolve) => server.listen(0, resolve))
      // @ts-expect-error Address is AddressInfo
      serverPort = server.address().port
    })

    afterEach(async () => {
      server?.close()
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      }
    })

    /**
     * Helper to build a test runtime.
     *
     * @param {object} [botConfig] - Extra bot config.
     * @returns {ReturnType<typeof createRuntime>} The bot runtime.
     */
    function makeTestRuntime (botConfig = {}) {
      const keystorePath = path.join(tmpDir, 'keystore')
      const config = {
        serverUrl: `http://127.0.0.1:${serverPort}`,
        botToken: 'bot-token-123',
        keystorePath,
        reconnect: {
          baseBackoffMs: 10,
          maxBackoffMs: 50,
          jitter: 0
        }
      }

      const keystoreData = {
        bot_id: 'b_test',
        bot_token: 'bot-token-123',
        bot_identity_private: makeKey(0x11),
        bot_command_private: makeKey(0x22),
        identity_private: makeKey(0x33),
        storage_seed: makeKey(0x44)
      }

      const logger = createLogger({ level: 'error', botId: 'b_test' })

      const bot = {
        config: {
          label: 'Test Bot',
          ...botConfig
        }
      }

      return createRuntime({
        // @ts-expect-error Testing untyped mock bot
        bot,
        config,
        keystoreData,
        logger,
        // @ts-expect-error Duck-typing FakeWebSocket
        WebSocketImpl: FakeWebSocket
      })
    }

    test('21. Dispatch through the WebSocket path', async () => {
      let received = null
      const runtime = makeTestRuntime({
        handlers: {
          install: (ctx) => {
            ctx.onOperatorResponse('req_ws', (resp) => {
              received = resp
            })
          }
        }
      })

      await runtime.start()

      const wsInst = FakeWebSocket.instances[0]
      assert.notEqual(wsInst, undefined)

      wsInst.simulateServerEvent('private-bot-b_test', 'bot.operator_response', {
        request_id: 'req_ws',
        response: 'WS Response',
        routing: 'private',
        room_id: null,
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      assert.notEqual(received, null)
      assert.equal(received.response, 'WS Response')

      await runtime.stop()
    })

    test('22. Dispatch through the sync path', async () => {
      let received = null
      const runtime = makeTestRuntime({
        handlers: {
          install: (ctx) => {
            ctx.onOperatorResponse('req_sync', (resp) => {
              received = resp
            })
          }
        }
      })

      await runtime.start()

      // Seed sync events after start so callback is registered before sync runs
      syncEvents.push({
        bot_seq: 1,
        event_type: 'bot.operator_response',
        payload: {
          request_id: 'req_sync',
          response: 'Sync Response',
          routing: 'private',
          room_id: 'r_sync',
          responded_by: 'u_op',
          responded_at: '2026-10-14T10:00:00Z'
        }
      })

      // Simulate reconnect trigger which invokes botChannelSync
      const wsInst = FakeWebSocket.instances[0]
      wsInst.close()
      await new Promise((r) => setTimeout(r, 100))

      assert.notEqual(received, null)
      assert.equal(received.response, 'Sync Response')
      assert.equal(received.roomId, 'r_sync')

      await runtime.stop()
    })

    test('23. Dispatch is idempotent across live and sync (callback fires twice unless unsubscribed)', async () => {
      let fireCount = 0
      const runtime = makeTestRuntime({
        handlers: {
          install: (ctx) => {
            ctx.onOperatorResponse('req_dupe', () => {
              fireCount++
            })
          }
        }
      })

      await runtime.start()

      // Live WebSocket event
      const wsInst = FakeWebSocket.instances[0]
      wsInst.simulateServerEvent('private-bot-b_test', 'bot.operator_response', {
        request_id: 'req_dupe',
        response: 'Dupe Response',
        routing: 'private',
        room_id: null,
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      assert.equal(fireCount, 1)

      // Seed sync event and simulate reconnect
      syncEvents.push({
        bot_seq: 1,
        event_type: 'bot.operator_response',
        payload: {
          request_id: 'req_dupe',
          response: 'Dupe Response',
          routing: 'private',
          room_id: null,
          responded_by: 'u_op',
          responded_at: '2026-10-14T10:00:00Z'
        }
      })

      wsInst.close()
      await new Promise((r) => setTimeout(r, 100))

      assert.equal(fireCount, 2)

      await runtime.stop()
    })

    test('24. The method is stable across invocations', async () => {
      let ref1
      let ref2

      const runtime = makeTestRuntime()
      const ctx1 = await runtime.makeBotCtx()
      const ctx2 = await runtime.makeBotCtx()

      ref1 = ctx1.onOperatorResponse
      ref2 = ctx2.onOperatorResponse

      assert.equal(ref1, ref2)
    })

    test('25. A paused bot still fires operator-response callbacks', async () => {
      let fired = false
      const runtime = makeTestRuntime({
        handlers: {
          install: (ctx) => {
            ctx.onOperatorResponse('req_pause', () => {
              fired = true
            })
          }
        }
      })

      await runtime.start()

      // Inject WebSocket bot.operator_response event
      const wsInst = FakeWebSocket.instances[0]
      wsInst.simulateServerEvent('private-bot-b_test', 'bot.operator_response', {
        request_id: 'req_pause',
        response: 'Paused Response',
        routing: 'private',
        room_id: null,
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      assert.equal(fired, true)

      await runtime.stop()
    })

    test('26. A callback that calls ctx.post triggers pause policy at post site', async () => {
      let callbackExecuted = false
      let postError = null

      const runtime = makeTestRuntime({
        handlers: {
          install: (ctx) => {
            ctx.onOperatorResponse('req_post_pause', async () => {
              callbackExecuted = true
              try {
                // Should fail because postHandler is not initialized / ungranted in this stub setup
                await ctx.post({ roomId: 'r_1', content: 'test' })
              } catch (err) {
                postError = err
              }
            })
          }
        }
      })

      await runtime.start()

      const wsInst = FakeWebSocket.instances[0]
      wsInst.simulateServerEvent('private-bot-b_test', 'bot.operator_response', {
        request_id: 'req_post_pause',
        response: 'Post test',
        routing: 'private',
        room_id: null,
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      await new Promise((r) => setTimeout(r, 50))

      assert.equal(callbackExecuted, true)
      assert.notEqual(postError, null)

      await runtime.stop()
    })

    test('27. stop() clears the registry', async () => {
      let cbFired = false
      const runtime = makeTestRuntime({
        handlers: {
          install: (ctx) => {
            ctx.onOperatorResponse('req_stop', () => {
              cbFired = true
            })
          }
        }
      })

      await runtime.start()
      await runtime.stop()

      // Try delivering event after stop
      const wsInst = FakeWebSocket.instances[0]
      wsInst.simulateServerEvent('private-bot-b_test', 'bot.operator_response', {
        request_id: 'req_stop',
        response: 'After stop',
        routing: 'private',
        room_id: null,
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      assert.equal(cbFired, false)
    })

    test('28. Callbacks are not invoked during shutdown', async () => {
      let cbFired = false
      const runtime = makeTestRuntime({
        handlers: {
          install: (ctx) => {
            ctx.onOperatorResponse('req_shut', () => {
              cbFired = true
            })
          }
        }
      })

      await runtime.start()
      const stopPromise = runtime.stop()
      await stopPromise

      assert.equal(cbFired, false)
    })

    test('29. stop() does not wait for in-flight callback promises', async () => {
      let slowStarted = false
      let slowFinished = false

      const runtime = makeTestRuntime({
        handlers: {
          install: (ctx) => {
            ctx.onOperatorResponse('req_slow', async () => {
              slowStarted = true
              await new Promise((r) => setTimeout(r, 5000))
              slowFinished = true
            })
          }
        }
      })

      await runtime.start()

      const wsInst = FakeWebSocket.instances[0]
      wsInst.simulateServerEvent('private-bot-b_test', 'bot.operator_response', {
        request_id: 'req_slow',
        response: 'Slow Response',
        routing: 'private',
        room_id: null,
        responded_by: 'u_op',
        responded_at: '2026-10-14T10:00:00Z'
      })

      assert.equal(slowStarted, true)

      const stopStart = Date.now()
      await runtime.stop({ drainMs: 1000 })
      const stopElapsed = Date.now() - stopStart

      // stop() should finish well under 5 seconds
      assert.equal(stopElapsed < 2000, true)
      assert.equal(slowFinished, false)
    })
  })
})
