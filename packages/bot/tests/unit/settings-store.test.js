import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createPublicKey } from 'node:crypto'
import { createSettingsStore } from '../../src/runtime/context/settings.js'
import { createHttpClient } from '../../src/runtime/transport/http.js'
import {
  encrypt,
  generateEphemeralKeypair,
  keyObjectFromX25519Private
} from '../../src/runtime/crypto/command-result.js'
import {
  SettingsWriteFailedError,
  SettingsReservedPrefixError
} from '../../src/errors.js'

const BOT_COMMAND_PRIVATE = Buffer.alloc(32, 0x77)
const BOT_COMMAND_PUBLIC = new Uint8Array(
  createPublicKey(
    keyObjectFromX25519Private(BOT_COMMAND_PRIVATE)
  ).export({ type: 'spki', format: 'der' }).subarray(12)
)

/**
 * Helper to encrypt a JS value into base64url wire format for settings.
 *
 * @param {unknown} value - Value to encrypt.
 * @returns {string} Encrypted base64url string.
 */
function encryptSettingValue (value) {
  const ephemeral = generateEphemeralKeypair()
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const inner = encrypt({
    privateKey: ephemeral.privateKey,
    peerPublicKey: BOT_COMMAND_PUBLIC,
    info: 'bot-settings-v1',
    plaintext
  })
  return Buffer.concat([ephemeral.publicKey, inner]).toString('base64url')
}

/**
 * @param {Array<{ level: string, msg: string, meta: any }>} logs - Log array collector.
 * @returns {import('../../src/runtime/diagnostics/logger.js').Logger} Mock logger instance.
 */
function createMockLogger (logs) {
  return {
    level: () => 'debug',
    log: () => {},
    debug: (/** @type {any} */ msg, /** @type {any} */ meta) => {
      logs.push({ level: 'debug', msg, meta })
    },
    info: (/** @type {any} */ msg, /** @type {any} */ meta) => {
      logs.push({ level: 'info', msg, meta })
    },
    warn: (/** @type {any} */ msg, /** @type {any} */ meta) => {
      logs.push({ level: 'warn', msg, meta })
    },
    error: (/** @type {any} */ msg, /** @type {any} */ meta) => {
      logs.push({ level: 'error', msg, meta })
    }
  }
}

describe('SettingsStore unit tests', () => {
  /** @type {import('node:http').Server} */
  let server
  let serverUrl = ''
  let requestCount = 0
  /** @type {import('node:http').RequestListener} */
  let serverHandler

  beforeEach(async () => {
    requestCount = 0
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([]))
    }

    server = createServer((req, res) => serverHandler(req, res))
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(undefined))
    })
    const addr = server.address()
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0
    serverUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('1. Cold get triggers a fetch and returns a value', async () => {
    const encValue = encryptSettingValue('secret-api-token')
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      assert.equal(req.url, '/bots/me/settings')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { key: 'apiToken', value_encrypted_bot: encValue, is_secret: true, user_seq: 1 }
      ]))
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      coalesceMs: 10
    })

    const val = await store.get('apiToken')
    assert.equal(val, 'secret-api-token')
    assert.equal(requestCount, 1)
    store.stop()
  })

  it('2. Second get is a cache hit', async () => {
    const encValue = encryptSettingValue('cached-token')
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { key: 'token', value_encrypted_bot: encValue, is_secret: false }
      ]))
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    const val1 = await store.get('token')
    assert.equal(val1, 'cached-token')
    assert.equal(requestCount, 1)

    const val2 = await store.get('token')
    assert.equal(val2, 'cached-token')
    assert.equal(requestCount, 1)
    store.stop()
  })

  it('3. Unknown key after fetch returns undefined', async () => {
    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    const val = await store.get('nonExistentKey')
    assert.equal(val, undefined)
    assert.equal(requestCount, 1)
    store.stop()
  })

  it('4. Concurrent gets share one fetch', async () => {
    const encValue = encryptSettingValue('shared-value')
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { key: 'sharedKey', value_encrypted_bot: encValue, is_secret: false }
      ]))
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    const [v1, v2, v3] = await Promise.all([
      store.get('sharedKey'),
      store.get('sharedKey'),
      store.get('sharedKey')
    ])

    assert.equal(v1, 'shared-value')
    assert.equal(v2, 'shared-value')
    assert.equal(v3, 'shared-value')
    assert.equal(requestCount, 1)
    store.stop()
  })

  it('5. room prefix in the storage key', async () => {
    const encValue = encryptSettingValue('room-specific-val')
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { key: 'room:r_abc:apiToken', value_encrypted_bot: encValue, is_secret: false }
      ]))
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    const val = await store.get('apiToken', { room: 'r_abc' })
    assert.equal(val, 'room-specific-val')
    store.stop()
  })

  it('6. Missing room reads the user-scoped key', async () => {
    const encValue = encryptSettingValue('user-val')
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { key: 'apiToken', value_encrypted_bot: encValue, is_secret: false }
      ]))
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    const userVal = await store.get('apiToken')
    assert.equal(userVal, 'user-val')

    const roomVal = await store.get('apiToken', { room: 'r_abc' })
    assert.equal(roomVal, undefined)
    store.stop()
  })

  it('7. Fetch failure leaves the cache empty', async () => {
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'internal_error' }))
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    const val = await store.get('apiToken')
    assert.equal(val, undefined)
    store.stop()
  })

  it('8. Fetch failure does not throw from get', async () => {
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end('Bad Gateway')
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    await assert.doesNotReject(async () => {
      const val = await store.get('apiToken')
      assert.equal(val, undefined)
    })
    store.stop()
  })

  it('9. Malformed response shape', async () => {
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ notAnArray: true }))
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    const val = await store.get('apiToken')
    assert.equal(val, undefined)
    store.stop()
  })

  it('10. Decryption failure on one entry skips it', async () => {
    const validEnc = encryptSettingValue('valid-val')
    const invalidEnc = 'invalid-wire-base64url'

    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { key: 'badKey', value_encrypted_bot: invalidEnc, is_secret: false },
        { key: 'goodKey', value_encrypted_bot: validEnc, is_secret: false }
      ]))
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    const good = await store.get('goodKey')
    const bad = await store.get('badKey')

    assert.equal(good, 'valid-val')
    assert.equal(bad, undefined)
    store.stop()
  })

  it('11. refresh() triggers a fetch after the coalesce window', async () => {
    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      coalesceMs: 20
    })

    store.refresh()
    assert.equal(requestCount, 0)

    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(requestCount, 1)
    store.stop()
  })

  it('12. Multiple refresh() calls within the window produce one fetch', async () => {
    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      coalesceMs: 30
    })

    store.refresh()
    store.refresh()
    store.refresh()

    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.equal(requestCount, 1)
    store.stop()
  })

  it('13. refresh() after the window schedules another fetch', async () => {
    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      coalesceMs: 20
    })

    store.refresh()
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(requestCount, 1)

    store.refresh()
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(requestCount, 2)
    store.stop()
  })

  it('14. Value change fires a subscriber', async () => {
    let currentVal = 'v1'
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { key: 'token', value_encrypted_bot: encryptSettingValue(currentVal), is_secret: false }
      ]))
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      coalesceMs: 10
    })

    // Populate initial
    await store.get('token')

    /** @type {unknown[]} */
    const fired = []
    store.subscribe('token', (/** @type {any} */ val) => fired.push(val))

    currentVal = 'v2'
    await store.refresh()
    await new Promise((resolve) => setTimeout(resolve, 30))

    assert.deepEqual(fired, ['v2'])
    store.stop()
  })

  it('15. Unchanged value does not fire a subscriber', async () => {
    const encVal = encryptSettingValue('same-value')
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { key: 'token', value_encrypted_bot: encVal, is_secret: false }
      ]))
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      coalesceMs: 10
    })

    await store.get('token')

    /** @type {unknown[]} */
    const fired = []
    store.subscribe('token', (/** @type {any} */ val) => fired.push(val))

    await store.refresh()
    await new Promise((resolve) => setTimeout(resolve, 30))

    assert.equal(fired.length, 0)
    store.stop()
  })

  it('16. Deleted key fires with undefined', async () => {
    let returnKey = true
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (returnKey) {
        res.end(JSON.stringify([
          { key: 'token', value_encrypted_bot: encryptSettingValue('val'), is_secret: false }
        ]))
      } else {
        res.end(JSON.stringify([]))
      }
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      coalesceMs: 10
    })

    await store.get('token')

    /** @type {unknown[]} */
    const fired = []
    store.subscribe('token', (/** @type {any} */ val) => fired.push(val))

    returnKey = false
    await store.refresh()
    await new Promise((resolve) => setTimeout(resolve, 30))

    assert.deepEqual(fired, [undefined])
    store.stop()
  })

  it('17. Added key fires with the new value', async () => {
    let returnNewKey = false
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      const list = []
      if (returnNewKey) {
        list.push({ key: 'newKey', value_encrypted_bot: encryptSettingValue('fresh'), is_secret: false })
      }
      res.end(JSON.stringify(list))
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      coalesceMs: 10
    })

    /** @type {unknown[]} */
    const fired = []
    store.subscribe('newKey', (/** @type {any} */ val) => fired.push(val))

    // First fetch cold
    await store.get('dummy')

    returnNewKey = true
    await store.refresh()
    await new Promise((resolve) => setTimeout(resolve, 30))

    assert.deepEqual(fired, ['fresh'])
    store.stop()
  })

  it('18. Subscriber throw does not prevent other subscribers', async () => {
    let val = 'v1'
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { key: 'k', value_encrypted_bot: encryptSettingValue(val), is_secret: false }
      ]))
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      coalesceMs: 10
    })

    await store.get('k')

    /** @type {unknown[]} */
    const fired = []

    store.subscribe('k', () => {
      throw new Error('Subscriber crash')
    })
    store.subscribe('k', (/** @type {any} */ v) => fired.push(v))

    val = 'v2'
    await store.refresh()
    await new Promise((resolve) => setTimeout(resolve, 30))

    assert.deepEqual(fired, ['v2'])
    store.stop()
  })

  it('19. Unsubscribe stops fires', async () => {
    let val = 'v1'
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { key: 'k', value_encrypted_bot: encryptSettingValue(val), is_secret: false }
      ]))
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      coalesceMs: 10
    })

    await store.get('k')

    /** @type {unknown[]} */
    const fired = []
    const unsub = store.subscribe('k', (/** @type {any} */ v) => fired.push(v))

    unsub()

    val = 'v2'
    await store.refresh()
    await new Promise((resolve) => setTimeout(resolve, 30))

    assert.equal(fired.length, 0)
    store.stop()
  })

  it('20. refresh() during an in-flight fetch schedules another', async () => {
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify([]))
      }, 50)
    }

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      coalesceMs: 10
    })

    store.refresh()
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(requestCount, 1)

    // Trigger refresh while request #1 is in flight
    store.refresh()

    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(requestCount, 2)
    store.stop()
  })

  it('21. set throws SettingsWriteFailedError', async () => {
    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    await assert.rejects(async () => {
      // @ts-ignore testing set method
      await store.set('key', 'value')
    }, (err) => {
      return err instanceof SettingsWriteFailedError && err.code === 'settings_write_failed'
    })
    store.stop()
  })

  it('22. delete throws SettingsWriteFailedError', async () => {
    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    await assert.rejects(async () => {
      await store.delete('key')
    }, (err) => {
      return err instanceof SettingsWriteFailedError && err.code === 'settings_write_failed'
    })
    store.stop()
  })

  it('23. set does not contact the server', async () => {
    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    try {
      // @ts-ignore testing set method
      await store.set('key', 'value')
    } catch {
      // expected
    }

    assert.equal(requestCount, 0)
    store.stop()
  })

  it('24. Non-string key throws TypeError', async () => {
    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    await assert.rejects(async () => {
      // @ts-ignore testing invalid type
      await store.get(123)
    }, TypeError)
    store.stop()
  })

  it('25. Empty key throws TypeError', async () => {
    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    await assert.rejects(async () => {
      await store.get('')
    }, TypeError)
    store.stop()
  })

  it('26. _runtime: prefix throws SettingsReservedPrefixError', async () => {
    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    await assert.rejects(async () => {
      await store.get('_runtime:internal')
    }, (err) => {
      return err instanceof SettingsReservedPrefixError && err.code === 'settings_reserved_prefix'
    })
    store.stop()
  })

  it('27. subscribe with non-function cb throws TypeError', async () => {
    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    assert.throws(() => {
      // @ts-ignore testing invalid cb type
      store.subscribe('key', 'not-a-func')
    }, TypeError)
    store.stop()
  })

  it('28. stop() prevents further refreshes', async () => {
    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      coalesceMs: 10
    })

    store.stop()
    store.refresh()

    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(requestCount, 0)
  })

  it('29. stop() is idempotent', async () => {
    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE
    })

    assert.doesNotThrow(() => {
      store.stop()
      store.stop()
    })
  })

  it('30. Logger emits debug on fetch', async () => {
    /** @type {Array<{ level: string, msg: string, meta: any }>} */
    const logs = []
    const logger = createMockLogger(logs)

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      logger
    })

    await store.get('apiToken')
    const debugEntry = logs.find((l) => l.msg === 'fetching bot settings')
    assert.ok(debugEntry)
    assert.equal(debugEntry.meta.bot_id, 'bot_123')
    store.stop()
  })

  it('31. Logger emits warn on fetch failure', async () => {
    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'fail' }))
    }

    /** @type {Array<{ level: string, msg: string, meta: any }>} */
    const logs = []
    const logger = createMockLogger(logs)

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      logger
    })

    await store.get('apiToken')
    const warnEntry = logs.find((l) => l.msg === 'settings refresh failed')
    assert.ok(warnEntry)
    assert.equal(warnEntry.meta.bot_id, 'bot_123')
    store.stop()
  })

  it('32. Logger does not log values or ciphertexts', async () => {
    const sensitiveVal = 'TOP_SECRET_VALUE_999'
    const encValue = encryptSettingValue(sensitiveVal)

    serverHandler = (/** @type {any} */ req, /** @type {any} */ res) => {
      requestCount++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { key: 'sensitiveKey', value_encrypted_bot: encValue, is_secret: true }
      ]))
    }

    /** @type {Array<{ level: string, msg: string, meta: any }>} */
    const logs = []
    const logger = createMockLogger(logs)

    const http = createHttpClient({ serverUrl, botToken: 'test-token' })
    const store = createSettingsStore({
      botId: 'bot_123',
      http,
      botCommandPrivateKey: BOT_COMMAND_PRIVATE,
      logger
    })

    await store.get('sensitiveKey')

    const logStr = JSON.stringify(logs)
    assert.equal(logStr.includes(sensitiveVal), false)
    assert.equal(logStr.includes(encValue), false)
    store.stop()
  })
})
