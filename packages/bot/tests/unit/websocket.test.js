import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createWebSocketClient } from '../../src/runtime/transport/websocket.js'

class FakeWebSocket {
  /** @type {FakeWebSocket[]} */
  static instances = []

  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  /**
   * @param {string} url - WebSocket URL.
   */
  constructor (url) {
    this.url = url
    this.readyState = 0 // CONNECTING
    /** @type {string[]} */
    this.sent = []
    /** @type {((event?: any) => void) | null} */
    this.onopen = null
    /** @type {((event: { data: string }) => void) | null} */
    this.onmessage = null
    /** @type {((event: any) => void) | null} */
    this.onerror = null
    /** @type {((event: { code: number, reason: string }) => void) | null} */
    this.onclose = null

    FakeWebSocket.instances.push(this)
  }

  /**
   * @param {string} data - Payload string.
   */
  send (data) {
    this.sent.push(data)
  }

  /**
   * @param {number} [code=1000] - Close code.
   * @param {string} [reason=''] - Close reason.
   */
  close (code = 1000, reason = '') {
    this.readyState = 3 // CLOSED
    if (this.onclose) {
      this.onclose({ code, reason })
    }
  }

  _open () {
    this.readyState = 1 // OPEN
    if (this.onopen) {
      this.onopen()
    }
  }

  /**
   * @param {object | string} obj - Message object or JSON string.
   */
  _message (obj) {
    if (this.onmessage) {
      this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) })
    }
  }

  /**
   * @param {any} err - Error cause.
   */
  _error (err) {
    if (this.onerror) {
      this.onerror(err)
    }
  }

  /**
   * @param {number} code - Close code.
   * @param {string} reason - Close reason.
   */
  _close (code, reason) {
    this.readyState = 3
    if (this.onclose) {
      this.onclose({ code, reason })
    }
  }
}

/** @type {any} */
const WSImpl = FakeWebSocket

describe('createWebSocketClient', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
  })

  /**
   * @param {string} _socketId - Socket ID.
   * @param {string} _channelName - Channel name.
   */
  const dummyAuth = async (_socketId, _channelName) => ({ auth: 'test-auth-sig' })

  test('1. Factory validates socketUrl', () => {
    // @ts-ignore
    assert.throws(() => createWebSocketClient({ socketUrl: '', appKey: 'key', authCallback: dummyAuth, WebSocketImpl: WSImpl }), /socketUrl must be a non-empty string/)
    // @ts-ignore
    assert.throws(() => createWebSocketClient({ socketUrl: 'http://sockudo.local', appKey: 'key', authCallback: dummyAuth, WebSocketImpl: WSImpl }), /socketUrl must begin with ws:\/\/ or wss:\/\//)
  })

  test('2. Factory validates appKey and authCallback', () => {
    // @ts-ignore
    assert.throws(() => createWebSocketClient({ socketUrl: 'ws://127.0.0.1:6001', appKey: '', authCallback: dummyAuth, WebSocketImpl: WSImpl }), /appKey must be a non-empty string/)
    // @ts-ignore
    assert.throws(() => createWebSocketClient({ socketUrl: 'ws://127.0.0.1:6001', appKey: 'key', authCallback: null, WebSocketImpl: WSImpl }), /authCallback must be a function/)
  })

  test('3. connect() opens a WebSocket with the correct URL', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001/',
      appKey: 'my-app-key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    const connectPromise = client.connect()
    assert.equal(FakeWebSocket.instances.length, 1)
    const ws = FakeWebSocket.instances[0]
    assert.equal(ws?.url, 'ws://127.0.0.1:6001/app/my-app-key?protocol=7&client=atollbot&version=1.0.0')

    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: '123.456', activity_timeout: 120 })
    })

    await connectPromise
  })

  test('4. connect() resolves after connection_established', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    let resolved = false
    const p = client.connect().then(() => { resolved = true })
    assert.equal(resolved, false)

    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1', activity_timeout: 30 })
    })

    await p
    assert.equal(resolved, true)
  })

  test('5. connect() is idempotent', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    const p1 = client.connect()
    const p2 = client.connect()
    assert.strictEqual(p1, p2)

    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })

    await Promise.all([p1, p2])

    const p3 = client.connect()
    await p3
    assert.equal(FakeWebSocket.instances.length, 1)
  })

  test('6. socketId is set after handshake', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    assert.equal(client.socketId(), undefined)
    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'socket-abc-123' })
    })
    await p
    assert.equal(client.socketId(), 'socket-abc-123')
  })

  test('7. isConnected is false before handshake, true after, false after close', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    assert.equal(client.isConnected(), false)
    const p = client.connect()
    assert.equal(client.isConnected(), false)

    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p
    assert.equal(client.isConnected(), true)

    const closeP = client.close()
    ws?._close(1000, 'done')
    await closeP
    assert.equal(client.isConnected(), false)
  })

  test('8. Subscribe before connect defers until connected', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    client.subscribe('private-bot-123', () => {})
    assert.equal(FakeWebSocket.instances.length, 0)

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })

    await p
    await new Promise((r) => setTimeout(r, 10))

    assert.equal(ws?.sent.length, 1)
    const sentMsg = JSON.parse(ws?.sent[0] ?? '{}')
    assert.equal(sentMsg.event, 'pusher:subscribe')
    assert.equal(sentMsg.data.channel, 'private-bot-123')
  })

  test('9. Subscribe after connect sends immediately', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    client.subscribe('private-bot-123', () => {})
    await new Promise((r) => setTimeout(r, 10))

    assert.equal(ws?.sent.length, 1)
    const sentMsg = JSON.parse(ws?.sent[0] ?? '{}')
    assert.equal(sentMsg.event, 'pusher:subscribe')
    assert.equal(sentMsg.data.channel, 'private-bot-123')
  })

  test('10. Subscribe sends the correct auth payload', async () => {
    /**
     * @param {string} socketId - Socket ID.
     * @param {string} channelName - Channel name.
     */
    const authCb = async (socketId, channelName) => {
      assert.equal(socketId, 'sock-999')
      assert.equal(channelName, 'private-bot-123')
      return { auth: 'app-key:sig12345' }
    }

    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: authCb,
      WebSocketImpl: WSImpl
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-999' })
    })
    await p

    client.subscribe('private-bot-123', () => {})
    await new Promise((r) => setTimeout(r, 10))

    const sentMsg = JSON.parse(ws?.sent[0] ?? '{}')
    assert.equal(sentMsg.data.auth, 'app-key:sig12345')
  })

  test('11. Subscribe includes channel_data when provided', async () => {
    const authCb = async () => ({ auth: 'app-key:sig', channel_data: '{"user_id":"bot-1"}' })

    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: authCb,
      WebSocketImpl: WSImpl
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    client.subscribe('private-bot-123', () => {})
    await new Promise((r) => setTimeout(r, 10))

    const sentMsg = JSON.parse(ws?.sent[0] ?? '{}')
    assert.equal(sentMsg.data.channel_data, '{"user_id":"bot-1"}')
  })

  test('12. Multiple handlers per channel share one subscription', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    client.subscribe('private-bot-123', () => {})
    client.subscribe('private-bot-123', () => {})
    await new Promise((r) => setTimeout(r, 10))

    assert.equal(ws?.sent.length, 1)
  })

  test('13. Unsubscribe sends pusher:unsubscribe when the last handler is removed', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    const unsub = client.subscribe('private-bot-123', () => {})
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(ws?.sent.length, 1)

    unsub()
    assert.equal(ws?.sent.length, 2)
    const unsubMsg = JSON.parse(ws?.sent[1] ?? '{}')
    assert.equal(unsubMsg.event, 'pusher:unsubscribe')
    assert.equal(unsubMsg.data.channel, 'private-bot-123')
  })

  test('14. Unsubscribe before the last handler does not send anything', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    const unsub1 = client.subscribe('private-bot-123', () => {})
    client.subscribe('private-bot-123', () => {})
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(ws?.sent.length, 1)

    unsub1()
    assert.equal(ws?.sent.length, 1)
  })

  test('15. Event dispatch to handler', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    /** @type {Array<{ event: string, data: any }>} */
    const received = []
    client.subscribe('private-bot-123', (eventName, data) => {
      received.push({ event: eventName, data })
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    ws?._message({
      event: 'bot.command_invoked',
      channel: 'private-bot-123',
      data: { command: 'ping' }
    })

    assert.equal(received.length, 1)
    assert.equal(received[0]?.event, 'bot.command_invoked')
    assert.deepEqual(received[0]?.data, { command: 'ping' })
  })

  test('16. Two handlers on same channel both fire', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    let fired1 = false
    let fired2 = false

    client.subscribe('private-bot-123', () => { fired1 = true })
    client.subscribe('private-bot-123', () => { fired2 = true })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    ws?._message({
      event: 'bot.command_invoked',
      channel: 'private-bot-123',
      data: {}
    })

    assert.equal(fired1, true)
    assert.equal(fired2, true)
  })

  test('17. Handler exception does not propagate', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    let fired2 = false

    client.subscribe('private-bot-123', () => {
      throw new Error('Boom in handler')
    })
    client.subscribe('private-bot-123', () => {
      fired2 = true
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    ws?._message({
      event: 'bot.command_invoked',
      channel: 'private-bot-123',
      data: {}
    })

    assert.equal(fired2, true)
  })

  test('18. pusher:ping triggers a pusher:pong reply', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    const sentBefore = ws?.sent.length ?? 0
    ws?._message({ event: 'pusher:ping', data: {} })

    assert.equal((ws?.sent.length ?? 0) - sentBefore, 1)
    const pongMsg = JSON.parse(ws?.sent[sentBefore] ?? '{}')
    assert.equal(pongMsg.event, 'pusher:pong')
  })

  test('19. Client ping timer sends pusher:ping after the interval', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl,
      pingIntervalMs: 5,
      pongTimeoutMs: 50
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    await new Promise((r) => setTimeout(r, 25))

    const pingSent = ws?.sent.some((m) => {
      try {
        return JSON.parse(m).event === 'pusher:ping'
      } catch {
        return false
      }
    })
    assert.equal(pingSent, true)
    await client.close()
  })

  test('20. Pong timeout closes the socket', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl,
      pingIntervalMs: 20,
      pongTimeoutMs: 10
    })

    let closedCode
    client.on('close', (payload) => {
      // @ts-ignore
      closedCode = payload?.code
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    await new Promise((r) => setTimeout(r, 40))

    assert.equal(closedCode, 4000)
  })

  test('21. pusher:error emits the error event', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    /** @type {any} */
    let emittedErr
    client.on('error', (err) => { emittedErr = err })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    ws?._message({
      event: 'pusher:error',
      data: { code: 4001, message: 'App disabled' }
    })

    assert.deepEqual(emittedErr, {
      event: 'pusher:error',
      data: { code: 4001, message: 'App disabled' }
    })
  })

  test('22. Auth failure emits error', async () => {
    const failingAuth = async () => {
      throw new Error('Auth HTTP 403')
    }

    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: failingAuth,
      WebSocketImpl: WSImpl
    })

    /** @type {any} */
    let emittedErr
    client.on('error', (err) => { emittedErr = err })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    client.subscribe('private-bot-123', () => {})
    await new Promise((r) => setTimeout(r, 10))

    assert.equal(emittedErr?.message, 'Auth HTTP 403')
    assert.equal(ws?.sent.length, 0)
  })

  test('23. Auth failure on one channel does not block others', async () => {
    /**
     * @param {string} _socketId - Socket ID.
     * @param {string} channelName - Channel name.
     */
    const selectiveAuth = async (_socketId, channelName) => {
      if (channelName === 'private-bad') {
        throw new Error('Auth failure')
      }
      return { auth: 'valid-sig' }
    }

    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: selectiveAuth,
      WebSocketImpl: WSImpl
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    client.subscribe('private-bad', () => {})
    client.subscribe('private-good', () => {})
    await new Promise((r) => setTimeout(r, 10))

    assert.equal(ws?.sent.length, 1)
    const msg = JSON.parse(ws?.sent[0] ?? '{}')
    assert.equal(msg.data.channel, 'private-good')
  })

  test('24. Server-initiated close emits close', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    /** @type {any} */
    let closePayload
    client.on('close', (payload) => { closePayload = payload })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    ws?._close(4001, 'server shutdown')

    assert.deepEqual(closePayload, { code: 4001, reason: 'server shutdown' })
  })

  test('25. close() sends unsubscribe messages and closes the socket', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    client.subscribe('private-bot-123', () => {})
    await new Promise((r) => setTimeout(r, 10))
    const sentCountBefore = ws?.sent.length ?? 0

    const closeP = client.close()
    ws?._close(1000, 'normal')
    await closeP

    assert.equal((ws?.sent.length ?? 0) - sentCountBefore, 1)
    const unsubMsg = JSON.parse(ws?.sent[sentCountBefore] ?? '{}')
    assert.equal(unsubMsg.event, 'pusher:unsubscribe')
  })

  test('26. close() resolves when the socket closes', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    let closeResolved = false
    const closeP = client.close().then(() => { closeResolved = true })
    assert.equal(closeResolved, false)

    ws?._close(1000, 'done')
    await closeP
    assert.equal(closeResolved, true)
  })

  test('27. close() before connect() resolves immediately', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    let resolved = false
    await client.close().then(() => { resolved = true })
    assert.equal(resolved, true)
  })

  test('28. close() on already-closed client is idempotent', async () => {
    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    const closeP1 = client.close()
    ws?._close(1000, 'done')
    await closeP1

    const closeP2 = client.close()
    await closeP2
  })

  test('29. Logger receives debug lines for open, subscribe, close', async () => {
    /** @type {Array<{ msg: string, meta?: any }>} */
    const logs = []
    /** @type {any} */
    const logger = {
      /**
       * @param {string} msg - Message.
       * @param {any} [meta] - Metadata.
       */
      debug: (msg, meta) => logs.push({ msg, meta }),
      /**
       * @param {string} msg - Message.
       * @param {any} [meta] - Metadata.
       */
      info: (msg, meta) => logs.push({ msg, meta }),
      /**
       * @param {string} msg - Message.
       * @param {any} [meta] - Metadata.
       */
      warn: (msg, meta) => logs.push({ msg, meta }),
      /**
       * @param {string} msg - Message.
       * @param {any} [meta] - Metadata.
       */
      error: (msg, meta) => logs.push({ msg, meta })
    }

    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl,
      logger
    })

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    client.subscribe('private-bot-123', () => {})
    await new Promise((r) => setTimeout(r, 10))

    const closeP = client.close()
    ws?._close(1000, 'done')
    await closeP

    const msgs = logs.map((l) => l.msg)
    assert.equal(msgs.includes('websocket connected'), true)
    assert.equal(msgs.includes('subscribed to channel'), true)
    assert.equal(msgs.includes('websocket closed'), true)
  })

  test('30. Logger does not log message data', async () => {
    /** @type {Array<{ msg: string, meta?: any }>} */
    const logs = []
    /** @type {any} */
    const logger = {
      /**
       * @param {string} msg - Message.
       * @param {any} [meta] - Metadata.
       */
      debug: (msg, meta) => logs.push({ msg, meta }),
      /**
       * @param {string} msg - Message.
       * @param {any} [meta] - Metadata.
       */
      info: (msg, meta) => logs.push({ msg, meta }),
      /**
       * @param {string} msg - Message.
       * @param {any} [meta] - Metadata.
       */
      warn: (msg, meta) => logs.push({ msg, meta }),
      /**
       * @param {string} msg - Message.
       * @param {any} [meta] - Metadata.
       */
      error: (msg, meta) => logs.push({ msg, meta })
    }

    const client = createWebSocketClient({
      socketUrl: 'ws://127.0.0.1:6001',
      appKey: 'key',
      authCallback: dummyAuth,
      WebSocketImpl: WSImpl,
      logger
    })

    client.subscribe('private-bot-123', () => {})

    const p = client.connect()
    const ws = FakeWebSocket.instances[0]
    ws?._open()
    ws?._message({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: 'sock-1' })
    })
    await p

    ws?._message({
      event: 'bot.command_invoked',
      channel: 'private-bot-123',
      data: { super_secret: 'sensitive_payload_data' }
    })

    for (const entry of logs) {
      const entryStr = JSON.stringify(entry)
      assert.equal(entryStr.includes('sensitive_payload_data'), false)
    }
  })
})
