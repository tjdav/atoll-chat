import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createLogger, SENSITIVE_KEYS } from '../../src/runtime/diagnostics/logger.js'

describe('Logger unit tests', () => {
  it('1. Basic line emitted', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      sink: (line) => lines.push(line)
    })

    logger.log('info', 'hello')

    assert.equal(lines.length, 1)
    const line = lines[0] ?? ''
    assert.ok(line.endsWith('\n'))

    const parsed = JSON.parse(line.trim())
    assert.equal(typeof parsed.ts, 'string')
    assert.ok(!isNaN(Date.parse(parsed.ts)))
    assert.equal(parsed.level, 'info')
    assert.equal(parsed.msg, 'hello')
    assert.equal(parsed.bot_id, 'b_x')
    assert.deepEqual(parsed.meta, {})
  })

  it('2. Level filter drops lower levels', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'warn',
      sink: (line) => lines.push(line)
    })

    logger.log('info', 'x')
    logger.log('debug', 'y')
    assert.equal(lines.length, 0)

    logger.log('warn', 'z')
    logger.log('error', 'q')
    assert.equal(lines.length, 2)

    const line0 = lines[0] ?? ''
    const line1 = lines[1] ?? ''
    const parsed1 = JSON.parse(line0.trim())
    const parsed2 = JSON.parse(line1.trim())
    assert.equal(parsed1.msg, 'z')
    assert.equal(parsed2.msg, 'q')
  })

  it('3. Silent level drops everything', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'silent',
      sink: (line) => lines.push(line)
    })

    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    logger.log('error', 'err')

    assert.equal(lines.length, 0)
  })

  it('4. Level-specific methods', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'debug',
      sink: (line) => lines.push(line)
    })

    logger.debug('a')
    logger.info('b')
    logger.warn('c')
    logger.error('d')

    assert.equal(lines.length, 4)
    assert.equal(JSON.parse(lines[0] ?? '').level, 'debug')
    assert.equal(JSON.parse(lines[1] ?? '').level, 'info')
    assert.equal(JSON.parse(lines[2] ?? '').level, 'warn')
    assert.equal(JSON.parse(lines[3] ?? '').level, 'error')
  })

  it('5. Context fields hoisted', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      sink: (line) => lines.push(line)
    })

    logger.log('info', 'x', {
      event_id: 'e1',
      room_id: 'r1',
      code: null,
      duration_ms: 42
    })

    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0] ?? '')
    assert.equal(parsed.event_id, 'e1')
    assert.equal(parsed.room_id, 'r1')
    assert.equal(parsed.code, null)
    assert.equal(parsed.duration_ms, 42)
    assert.deepEqual(parsed.meta, {})
  })

  it('6. Meta fields preserved', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      sink: (line) => lines.push(line)
    })

    logger.log('info', 'x', {
      handler: 'message',
      attempts: 3
    })

    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0] ?? '')
    assert.equal(parsed.meta.handler, 'message')
    assert.equal(parsed.meta.attempts, 3)
  })

  it('7. Unknown key redacted', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      sink: (line) => lines.push(line)
    })

    logger.log('info', 'x', {
      authorization: 'Bearer abc'
    })

    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0] ?? '')
    assert.equal(parsed.meta.authorization, '[REDACTED]')
  })

  it('8. Case and separator variants redacted', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      sink: (line) => lines.push(line)
    })

    logger.log('info', 'x', {
      Authorization: 'x',
      'private-key': 'y'
    })

    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0] ?? '')
    assert.equal(parsed.meta.Authorization, '[REDACTED]')
    assert.equal(parsed.meta['private-key'], '[REDACTED]')
  })

  it('9. Nested redaction', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      sink: (line) => lines.push(line)
    })

    logger.log('info', 'x', {
      outer: {
        token: 'abc',
        ok: 1
      }
    })

    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0] ?? '')
    assert.equal(parsed.meta.outer.token, '[REDACTED]')
    assert.equal(parsed.meta.outer.ok, 1)
  })

  it('10. Array redaction', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      sink: (line) => lines.push(line)
    })

    logger.log('info', 'x', {
      items: [{
        password: 'p'
      }]
    })

    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0] ?? '')
    assert.equal(parsed.meta.items[0].password, '[REDACTED]')
  })

  it('11. Cyclic meta', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      sink: (line) => lines.push(line)
    })

    /** @type {Record<string, unknown>} */
    const a = {}
    a.self = a

    assert.doesNotThrow(() => {
      logger.log('info', 'x', {
        a
      })
    })

    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0] ?? '')
    assert.ok(parsed.meta.a)
  })

  it('12. _secret: in dev mode throws', () => {
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      dev: true,
      sink: () => {}
    })

    assert.throws(
      () => {
        logger.log('info', 'x', {
          '_secret:apiToken': 'abc'
        })
      },
      (err) => {
        return err instanceof Error && err.message.includes('_secret:apiToken')
      }
    )
  })

  it('13. _secret: in prod mode redacts', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      dev: false,
      sink: (line) => lines.push(line)
    })

    logger.log('info', 'x', {
      '_secret:apiToken': 'abc'
    })

    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0] ?? '')
    assert.equal(parsed.meta['_secret:apiToken'], '[REDACTED]')
  })

  it('14. _secret: case-insensitive', () => {
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      dev: true,
      sink: () => {}
    })

    assert.throws(
      () => {
        logger.log('info', 'x', {
          '_SECRET:apiToken': 'abc'
        })
      },
      (err) => {
        return err instanceof Error && err.message.includes('_SECRET:apiToken')
      }
    )
  })

  it('15. URL query stripped', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      sink: (line) => lines.push(line)
    })

    logger.log('info', 'x', {
      url: 'https://api.example.com/v1/items?token=abc&page=2'
    })

    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0] ?? '')
    assert.equal(parsed.meta.url, 'https://api.example.com/v1/items')
  })

  it('16. Malformed URL unchanged', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      sink: (line) => lines.push(line)
    })

    logger.log('info', 'x', {
      url: 'not a url'
    })

    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0] ?? '')
    assert.equal(parsed.meta.url, 'not a url')
  })

  it('17. BigInt in meta', () => {
    /** @type {string[]} */
    const lines = []
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      sink: (line) => lines.push(line)
    })

    logger.log('info', 'x', {
      big: BigInt(1)
    })

    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0] ?? '')
    assert.equal(parsed.msg, 'log serialization failed')
    assert.ok(typeof parsed.meta.error === 'string')
    assert.ok(parsed.meta.error.includes('BigInt'))
  })

  it('18. Sink throws', () => {
    const logger = createLogger({
      botId: 'b_x',
      level: 'info',
      sink: () => {
        throw new Error('broken pipe')
      }
    })

    assert.doesNotThrow(() => {
      logger.log('info', 'hello')
    })
  })

  it('19. Bot ID is required', () => {
    assert.throws(
      () => {
        // @ts-expect-error - Testing missing botId
        createLogger({})
      },
      (err) => {
        return err instanceof Error && err.message.includes('Logger requires a valid botId string')
      }
    )
  })

  it('20. SENSITIVE_KEYS exported', () => {
    assert.ok(SENSITIVE_KEYS instanceof Set)
    assert.ok(SENSITIVE_KEYS.has('password'))
    assert.ok(SENSITIVE_KEYS.has('privatekey'))
    assert.ok(SENSITIVE_KEYS.has('authorization'))
  })
})
