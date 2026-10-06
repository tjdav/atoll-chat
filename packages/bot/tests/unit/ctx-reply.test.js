import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createReplyHandler } from '../../src/runtime/context/reply.js'
import { ReplyRequiresReplyToError, PostFailedError } from '../../src/errors.js'

function makePostSpy () {
  /** @type {Array<{ opts: any, ctx: any }>} */
  const calls = []
  /**
   * @param {any} opts
   * @param {any} ctx
   */
  const post = async (opts, ctx) => {
    calls.push({ opts, ctx })
    return {
      id: 'm_fake',
      roomId: opts?.roomId ?? ctx?.grant?.roomId ?? 'r_fake',
      createdAt: '2026-10-06T00:00:00Z'
    }
  }
  return { post, calls }
}

function makeLoggerSpy () {
  /** @type {Array<{ level: string, message: string, meta?: any }>} */
  const logs = []
  /** @type {any} */
  const logger = {
    /**
     * @param {string} lineLevel
     * @param {string} msg
     * @param {any} [meta]
     */
    log (lineLevel, msg, meta) {
      logs.push({ level: lineLevel, message: msg, meta })
    },
    /**
     * @param {string} message
     * @param {any} [meta]
     */
    debug (message, meta) {
      logs.push({ level: 'debug', message, meta })
    },
    /**
     * @param {string} message
     * @param {any} [meta]
     */
    info (message, meta) {
      logs.push({ level: 'info', message, meta })
    },
    /**
     * @param {string} message
     * @param {any} [meta]
     */
    warn (message, meta) {
      logs.push({ level: 'warn', message, meta })
    },
    /**
     * @param {string} message
     * @param {any} [meta]
     */
    error (message, meta) {
      logs.push({ level: 'error', message, meta })
    },
    level () {
      return 'debug'
    }
  }
  return { logger, logs }
}

describe('ctx.reply', () => {
  test('1. Happy path', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })
    const opts = { replyTo: 'm_1', text: 'hello' }
    const ctx = { grant: { roomId: 'r_x', mode: 'write_only' } }

    const result = await reply(opts, ctx)

    assert.deepEqual(result, {
      id: 'm_fake',
      roomId: 'r_x',
      createdAt: '2026-10-06T00:00:00Z'
    })
    assert.equal(spy.calls.length, 1)
    assert.deepEqual(spy.calls[0], { opts, ctx })
  })

  test('2. replyTo present but other fields absent', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })
    const opts = { replyTo: 'm_1' }

    const result = await reply(opts, null)

    assert.equal(result.id, 'm_fake')
    assert.equal(spy.calls.length, 1)
    assert.equal(spy.calls[0]?.opts, opts)
  })

  test('3. opts is undefined', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })

    await assert.rejects(
      async () => reply(/** @type {any} */ (undefined), null),
      (err) => {
        assert.ok(err instanceof ReplyRequiresReplyToError)
        assert.equal(err.code, 'reply_requires_reply_to')
        return true
      }
    )
    assert.equal(spy.calls.length, 0)
  })

  test('4. opts is null', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })

    await assert.rejects(
      async () => reply(/** @type {any} */ (null), null),
      (err) => {
        assert.ok(err instanceof ReplyRequiresReplyToError)
        assert.equal(err.code, 'reply_requires_reply_to')
        return true
      }
    )
    assert.equal(spy.calls.length, 0)
  })

  test('5. opts.replyTo is missing', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })

    await assert.rejects(
      async () => reply(/** @type {any} */ ({ text: 'hi' }), null),
      (err) => {
        assert.ok(err instanceof ReplyRequiresReplyToError)
        assert.equal(err.code, 'reply_requires_reply_to')
        return true
      }
    )
    assert.equal(spy.calls.length, 0)
  })

  test('6. opts.replyTo is undefined', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })

    await assert.rejects(
      async () => reply(/** @type {any} */ ({ replyTo: undefined }), null),
      ReplyRequiresReplyToError
    )
    assert.equal(spy.calls.length, 0)
  })

  test('7. opts.replyTo is null', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })

    await assert.rejects(
      async () => reply(/** @type {any} */ ({ replyTo: null }), null),
      ReplyRequiresReplyToError
    )
    assert.equal(spy.calls.length, 0)
  })

  test('8. opts.replyTo is an empty string', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })

    await assert.rejects(
      async () => reply({ replyTo: '' }, null),
      ReplyRequiresReplyToError
    )
    assert.equal(spy.calls.length, 0)
  })

  test('9. opts.replyTo is a non-empty string', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })

    await reply({ replyTo: 'm_valid' }, null)
    assert.equal(spy.calls.length, 1)
    assert.equal(spy.calls[0]?.opts.replyTo, 'm_valid')
  })

  test('10. opts.replyTo is a non-string (number, object, array)', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })

    await assert.rejects(async () => reply(/** @type {any} */ ({ replyTo: 123 }), null), ReplyRequiresReplyToError)
    await assert.rejects(async () => reply(/** @type {any} */ ({ replyTo: {} }), null), ReplyRequiresReplyToError)
    await assert.rejects(async () => reply(/** @type {any} */ ({ replyTo: ['m_1'] }), null), ReplyRequiresReplyToError)
    assert.equal(spy.calls.length, 0)
  })

  test('11. Error code is reply_requires_reply_to', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })

    try {
      await reply(/** @type {any} */ ({ text: 'hi' }), null)
      assert.fail('should have thrown')
    } catch (err) {
      assert.equal(/** @type {any} */ (err).code, 'reply_requires_reply_to')
    }
  })

  test('12. Error is an instance of ReplyRequiresReplyToError', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })

    try {
      await reply(/** @type {any} */ ({ text: 'hi' }), null)
      assert.fail('should have thrown')
    } catch (err) {
      assert.ok(err instanceof ReplyRequiresReplyToError)
    }
  })

  test('13. Post errors propagate unchanged', async () => {
    const postError = new PostFailedError('network error')
    const post = async () => {
      throw postError
    }
    const reply = createReplyHandler({ post })

    try {
      await reply({ replyTo: 'm_1' }, null)
      assert.fail('should have thrown')
    } catch (err) {
      assert.strictEqual(err, postError)
    }
  })

  test('14. Post errors do not become ReplyRequiresReplyToError', async () => {
    const postError = new PostFailedError('network error')
    const post = async () => {
      throw postError
    }
    const reply = createReplyHandler({ post })

    try {
      await reply({ replyTo: 'm_1' }, null)
      assert.fail('should have thrown')
    } catch (err) {
      assert.equal(/** @type {any} */ (err).code, 'post_failed')
      assert.notEqual(/** @type {any} */ (err).code, 'reply_requires_reply_to')
    }
  })

  test('15. opts.roomId is not modified', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })
    const opts = { replyTo: 'm_1', roomId: 'r_a' }

    await reply(opts, null)
    assert.equal(spy.calls[0]?.opts.roomId, 'r_a')
  })

  test('16. opts.text and opts.attachments are not modified', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })
    /** @type {AttachmentRef[]} */
    const attachments = [{ fileId: 'f1', size: 10, contentType: 'image/png' }]
    const opts = { replyTo: 'm_1', text: 'hello', attachments }

    await reply(opts, null)
    assert.equal(spy.calls[0]?.opts.text, 'hello')
    assert.strictEqual(spy.calls[0]?.opts.attachments, attachments)
  })

  test('17. ctx is passed by reference', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })
    const ctx = { grant: { roomId: 'r_x' } }

    await reply({ replyTo: 'm_1' }, ctx)
    assert.strictEqual(spy.calls[0]?.ctx, ctx)
  })

  test('18. Wrapper does not re-validate opts.roomId', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })
    const opts = { replyTo: 'm_1', roomId: '' }

    await reply(opts, null)
    assert.equal(spy.calls.length, 1)
    assert.equal(spy.calls[0]?.opts.roomId, '')
  })

  test('19. Concurrent calls do not share state', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })

    const p1 = reply({ replyTo: 'm_1', text: 'first' }, { grant: { roomId: 'r_1' } })
    const p2 = reply({ replyTo: 'm_2', text: 'second' }, { grant: { roomId: 'r_2' } })

    await Promise.all([p1, p2])

    assert.equal(spy.calls.length, 2)
    const texts = spy.calls.map(c => c.opts.text)
    assert.ok(texts.includes('first'))
    assert.ok(texts.includes('second'))
  })

  test('20. Logger emits debug on rejection', async () => {
    const spy = makePostSpy()
    const loggerSpy = makeLoggerSpy()
    const reply = createReplyHandler({ post: spy.post, logger: loggerSpy.logger })

    await assert.rejects(
      async () => reply(/** @type {any} */ ({ roomId: 'r_x' }), null),
      ReplyRequiresReplyToError
    )

    assert.equal(loggerSpy.logs.length, 1)
    assert.equal(loggerSpy.logs[0]?.level, 'debug')
    assert.equal(loggerSpy.logs[0]?.message, 'reply rejected: replyTo missing')
    assert.deepEqual(loggerSpy.logs[0]?.meta, { room_id: 'r_x' })
  })

  test('21. Logger falls back to ctx.grant.roomId', async () => {
    const spy = makePostSpy()
    const loggerSpy = makeLoggerSpy()
    const reply = createReplyHandler({ post: spy.post, logger: loggerSpy.logger })
    const ctx = { grant: { roomId: 'r_y' } }

    await assert.rejects(
      async () => reply(/** @type {any} */ ({}), ctx),
      ReplyRequiresReplyToError
    )

    assert.equal(loggerSpy.logs.length, 1)
    assert.deepEqual(loggerSpy.logs[0]?.meta, { room_id: 'r_y' })
  })

  test('22. Logger uses null when neither is available', async () => {
    const spy = makePostSpy()
    const loggerSpy = makeLoggerSpy()
    const reply = createReplyHandler({ post: spy.post, logger: loggerSpy.logger })

    await assert.rejects(
      async () => reply(/** @type {any} */ ({}), null),
      ReplyRequiresReplyToError
    )

    assert.equal(loggerSpy.logs.length, 1)
    assert.deepEqual(loggerSpy.logs[0]?.meta, { room_id: null })
  })

  test('23. Logger emits nothing on success', async () => {
    const spy = makePostSpy()
    const loggerSpy = makeLoggerSpy()
    const reply = createReplyHandler({ post: spy.post, logger: loggerSpy.logger })

    await reply({ replyTo: 'm_1' }, null)

    assert.equal(loggerSpy.logs.length, 0)
  })

  test('24. replyTo value is not logged', async () => {
    const spy = makePostSpy()
    const loggerSpy = makeLoggerSpy()
    const reply = createReplyHandler({ post: spy.post, logger: loggerSpy.logger })
    const replyTarget = 'm_secret_target_id'

    await assert.rejects(
      async () => reply(/** @type {any} */ ({ replyTo: '', roomId: 'r_x' }), null),
      ReplyRequiresReplyToError
    )

    const serialized = JSON.stringify(loggerSpy.logs)
    assert.ok(!serialized.includes(replyTarget))
    assert.ok(!serialized.includes('reply_to'))
  })

  test('25. createReplyHandler is idempotent over calls', async () => {
    const spy = makePostSpy()
    const reply = createReplyHandler({ post: spy.post })

    const res1 = await reply({ replyTo: 'm_1' }, { grant: { roomId: 'r_1' } })
    const res2 = await reply({ replyTo: 'm_2' }, { grant: { roomId: 'r_2' } })

    assert.equal(res1.id, 'm_fake')
    assert.equal(res2.id, 'm_fake')
    assert.equal(spy.calls.length, 2)
    assert.equal(spy.calls[0]?.opts.replyTo, 'm_1')
    assert.equal(spy.calls[1]?.opts.replyTo, 'm_2')
  })
})
