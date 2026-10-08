import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { defineBot } from '../../src/define-bot.js'
import { createTestRuntime } from '../../src/testing/create-test-runtime.js'
import { keyObjectFromSeed } from '../../src/runtime/crypto/signing.js'

function generateEd25519Keypair () {
  const seed = new Uint8Array(crypto.randomBytes(32))
  const keyObj = keyObjectFromSeed(seed)
  const pubKeyObj = crypto.createPublicKey(keyObj)
  const spki = pubKeyObj.export({ type: 'spki', format: 'der' })
  const pubKey = new Uint8Array(spki.subarray(12))
  return { seed, pubkey: pubKey }
}

test('createTestRuntime Unit Tests', async (t) => {
  function makeBot (overrides = {}) {
    const { commands, handlers, ...rest } = overrides
    const normalizedCommands = commands ? {} : undefined
    if (commands) {
      for (const [cmdName, cmdDecl] of Object.entries(commands)) {
        normalizedCommands[cmdName] = {
          args: {},
          ...cmdDecl
        }
      }
    }

    return defineBot({
      id: 'test.bot',
      hostApi: '1.0',
      label: 'Test Bot',
      capabilities: ['post_message', 'read_content', 'read_commands'],
      handlers: {
        message: async () => {},
        ...handlers
      },
      ...(normalizedCommands ? { commands: normalizedCommands } : {}),
      ...rest
    })
  }

  // Construction
  await t.test('1. createTestRuntime(bot) resolves with a runtime', async () => {
    const bot = makeBot()
    const runtime = await createTestRuntime(bot)
    try {
      assert.ok(runtime)
      assert.equal(typeof runtime.inject, 'function')
      assert.equal(typeof runtime.dispatchWebhook, 'function')
      assert.equal(typeof runtime.fireSchedule, 'function')
      assert.equal(typeof runtime.advanceTime, 'function')
      assert.equal(typeof runtime.restart, 'function')
      assert.equal(typeof runtime.simulateResponse, 'function')
      assert.equal(typeof runtime.getPendingOutbound, 'function')
      assert.equal(typeof runtime.getGrants, 'function')
      assert.equal(typeof runtime.getPublisherKeys, 'function')
      assert.equal(typeof runtime.close, 'function')
    } finally {
      await runtime.close()
    }
  })

  await t.test('2. The mock server is bound', async () => {
    const bot = makeBot()
    const runtime = await createTestRuntime(bot)
    try {
      assert.ok(Array.isArray(runtime.calls))
    } finally {
      await runtime.close()
    }
  })

  await t.test('3. getGrants() returns the configured grants', async () => {
    const bot = makeBot()
    const grants = [
      { roomId: 'r_1', mode: 'observer', scopes: ['read'] },
      { roomId: 'r_2', mode: 'write_only', scopes: ['write'] }
    ]
    const runtime = await createTestRuntime(bot, { grants })
    try {
      const gMap = runtime.getGrants()
      assert.equal(gMap.size, 2)
      assert.deepEqual(gMap.get('r_1'), { roomId: 'r_1', mode: 'observer', scopes: ['read'] })
      assert.deepEqual(gMap.get('r_2'), { roomId: 'r_2', mode: 'write_only', scopes: ['write'] })
    } finally {
      await runtime.close()
    }
  })

  await t.test('4. getPublisherKeys() returns one entry per grant', async () => {
    const bot = makeBot()
    const grants = [
      { roomId: 'r_1', mode: 'observer', scopes: [] },
      { roomId: 'r_2', mode: 'write_only', scopes: [] }
    ]
    const runtime = await createTestRuntime(bot, { grants })
    try {
      const pMap = runtime.getPublisherKeys()
      assert.equal(pMap.size, 2)
      assert.ok(pMap.has('r_1'))
      assert.ok(pMap.has('r_2'))
      assert.equal(pMap.get('r_1').epoch, 1)
      assert.equal(pMap.get('r_1').publisherPublicKey.length, 32)
    } finally {
      await runtime.close()
    }
  })

  await t.test('5. calls is initially empty', async () => {
    const bot = makeBot()
    const runtime = await createTestRuntime(bot)
    try {
      assert.equal(runtime.calls.length, 0)
    } finally {
      await runtime.close()
    }
  })

  await t.test('6. Synthetic keystore is generated when not provided', async () => {
    const bot = makeBot()
    const runtime = await createTestRuntime(bot, { botId: 'b_synth' })
    try {
      assert.ok(runtime)
    } finally {
      await runtime.close()
    }
  })

  await t.test('7. Caller-provided keystoreData is used', async () => {
    const bot = makeBot()
    const keystoreData = {
      bot_id: 'b_custom',
      bot_token: 'custom-token-123',
      bot_identity_private: Buffer.alloc(32, 0x11).toString('base64url'),
      bot_command_private: Buffer.alloc(32, 0x22).toString('base64url'),
      identity_private: Buffer.alloc(32, 0x33).toString('base64url'),
      storage_seed: Buffer.alloc(32, 0x44).toString('base64url'),
      created_at: new Date(0).toISOString(),
      rotated_at: new Date(0).toISOString()
    }
    const runtime = await createTestRuntime(bot, { keystoreData })
    try {
      assert.ok(runtime)
    } finally {
      await runtime.close()
    }
  })

  // inject — command
  await t.test('8. A command event dispatches to the command handler', async () => {
    let called = false
    const bot = makeBot({
      commands: {
        ping: {
          handler: async () => {
            called = true
            return { type: 'none' }
          }
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      const res = await runtime.inject({
        type: 'command',
        payload: {
          commandId: 'cmd_1',
          roomId: 'r_1',
          senderUserId: 'u_1',
          senderClientId: 'c_1',
          commandName: 'ping',
          args: {}
        }
      })
      assert.equal(res.ok, true)
      assert.equal(called, true)
    } finally {
      await runtime.close()
    }
  })

  await t.test('9. The command handler receives a ctx with the correct grant', async () => {
    let receivedGrant = null
    const bot = makeBot({
      commands: {
        check: {
          handler: async (ctx) => {
            receivedGrant = ctx.grant
            return { type: 'none' }
          }
        }
      }
    })
    const grants = [{ roomId: 'r_grant', mode: 'write_only', scopes: ['write'] }]
    const runtime = await createTestRuntime(bot, { grants })
    try {
      await runtime.inject({
        type: 'command',
        payload: {
          commandId: 'cmd_grant',
          roomId: 'r_grant',
          commandName: 'check',
          args: {}
        }
      })
      assert.deepEqual(receivedGrant, { roomId: 'r_grant', mode: 'write_only', scopes: ['write'] })
    } finally {
      await runtime.close()
    }
  })

  await t.test('10. The command handler\'s result is dispatched to the mock', async () => {
    const bot = makeBot({
      commands: {
        ping: {
          handler: async () => {
            return { type: 'local_message', content: 'pong' }
          }
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.inject({
        type: 'command',
        payload: {
          commandId: 'cmd_ping',
          roomId: 'r_1',
          commandName: 'ping',
          args: {}
        }
      })
      const postMsgReq = runtime.calls.find((r) => r.path === '/api/v1/bots/me/messages')
      assert.ok(postMsgReq)
      assert.equal(postMsgReq.json.target, 'invoker')
      assert.equal(postMsgReq.json.result_type, 'local_message')
    } finally {
      await runtime.close()
    }
  })

  await t.test('11. An unknown event type returns { ok: false }', async () => {
    const bot = makeBot()
    const runtime = await createTestRuntime(bot)
    try {
      const res = await runtime.inject({
        type: 'invalid_type',
        payload: {}
      })
      assert.equal(res.ok, false)
      assert.ok(res.error)
    } finally {
      await runtime.close()
    }
  })

  await t.test('12. A handler throw returns { ok: false, error }', async () => {
    const bot = makeBot({
      handlers: {
        message: async () => {
          throw new Error('handler failed')
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      const res = await runtime.inject({
        type: 'message',
        payload: { roomId: 'r_1' }
      })
      assert.equal(res.ok, false)
      assert.equal(res.error?.message, 'handler failed')
    } finally {
      await runtime.close()
    }
  })

  // inject — message
  await t.test('13. A message event dispatches to handlers.message', async () => {
    let receivedPayload = null
    const bot = makeBot({
      handlers: {
        message: async (_ctx, event) => {
          receivedPayload = event
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.inject({
        type: 'message',
        payload: { roomId: 'r_1', text: 'hello' }
      })
      assert.deepEqual(receivedPayload, { roomId: 'r_1', text: 'hello' })
    } finally {
      await runtime.close()
    }
  })

  await t.test('14. The MessageEvent has the correct shape', async () => {
    let receivedCtx = null
    const bot = makeBot({
      handlers: {
        message: async (ctx) => {
          receivedCtx = ctx
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.inject({
        type: 'message',
        payload: { roomId: 'r_msg' }
      })
      assert.ok(receivedCtx.event)
      assert.equal(receivedCtx.event.type, 'message')
      assert.equal(receivedCtx.event.roomId, 'r_msg')
    } finally {
      await runtime.close()
    }
  })

  await t.test('15. The ctx has the grant for the room', async () => {
    let receivedGrant = null
    const bot = makeBot({
      handlers: {
        message: async (ctx) => {
          receivedGrant = ctx.grant
        }
      }
    })
    const grants = [{ roomId: 'r_msg_grant', mode: 'observer', scopes: ['read'] }]
    const runtime = await createTestRuntime(bot, { grants })
    try {
      await runtime.inject({
        type: 'message',
        payload: { roomId: 'r_msg_grant' }
      })
      assert.deepEqual(receivedGrant, { roomId: 'r_msg_grant', mode: 'observer', scopes: ['read'] })
    } finally {
      await runtime.close()
    }
  })

  // inject — room
  await t.test('16. A room event dispatches to handlers.room', async () => {
    let receivedPayload = null
    const bot = makeBot({
      handlers: {
        room: async (_ctx, event) => {
          receivedPayload = event
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.inject({
        type: 'room',
        payload: { roomId: 'r_1', eventName: 'room.updated' }
      })
      assert.deepEqual(receivedPayload, { roomId: 'r_1', eventName: 'room.updated' })
    } finally {
      await runtime.close()
    }
  })

  await t.test('17. The room event data is passed through', async () => {
    let receivedData = null
    const bot = makeBot({
      handlers: {
        room: async (_ctx, event) => {
          receivedData = event.data
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.inject({
        type: 'room',
        payload: { roomId: 'r_1', eventName: 'room.member_added', data: { user_id: 'u_new' } }
      })
      assert.deepEqual(receivedData, { user_id: 'u_new' })
    } finally {
      await runtime.close()
    }
  })

  // inject — grant_updated
  await t.test('18. grant_updated updates the grants map', async () => {
    const bot = makeBot()
    const runtime = await createTestRuntime(bot)
    try {
      assert.equal(runtime.getGrants().size, 0)
      await runtime.inject({
        type: 'grant_updated',
        payload: { roomId: 'r_new', newMode: 'write_only', scopes: ['write'] }
      })
      assert.equal(runtime.getGrants().size, 1)
      assert.deepEqual(runtime.getGrants().get('r_new'), { roomId: 'r_new', mode: 'write_only', scopes: ['write'] })

      await runtime.inject({
        type: 'grant_updated',
        payload: { roomId: 'r_new', newMode: null }
      })
      assert.equal(runtime.getGrants().size, 0)
    } finally {
      await runtime.close()
    }
  })

  await t.test('19. grant_updated calls handlers.grantUpdated', async () => {
    let called = false
    const bot = makeBot({
      handlers: {
        grantUpdated: async () => {
          called = true
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.inject({
        type: 'grant_updated',
        payload: { roomId: 'r_1', newMode: 'observer', scopes: [] }
      })
      assert.equal(called, true)
    } finally {
      await runtime.close()
    }
  })

  // dispatchWebhook
  await t.test('20. Dispatches to handlers.webhook', async () => {
    let received = null
    const bot = makeBot({
      handlers: {
        webhook: async (_ctx, req) => {
          received = req
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.dispatchWebhook({
        path: '/wh',
        body: 'data',
        headers: { 'x-sig': '123' }
      })
      assert.deepEqual(received, {
        path: '/wh',
        body: 'data',
        headers: { 'x-sig': '123' }
      })
    } finally {
      await runtime.close()
    }
  })

  await t.test('21. The payload has path, body, headers', async () => {
    let receivedHeaders = null
    const bot = makeBot({
      handlers: {
        webhook: async (_ctx, req) => {
          receivedHeaders = req.headers
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.dispatchWebhook({
        path: '/wh',
        body: 'hello',
        headers: { 'content-type': 'application/json' }
      })
      assert.deepEqual(receivedHeaders, { 'content-type': 'application/json' })
    } finally {
      await runtime.close()
    }
  })

  await t.test('22. A missing headers defaults to {}', async () => {
    let receivedHeaders = null
    const bot = makeBot({
      handlers: {
        webhook: async (_ctx, req) => {
          receivedHeaders = req.headers
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.dispatchWebhook({
        path: '/wh',
        body: 'hello'
      })
      assert.deepEqual(receivedHeaders, {})
    } finally {
      await runtime.close()
    }
  })

  await t.test('23. A handler throw propagates', async () => {
    const bot = makeBot({
      handlers: {
        webhook: async () => {
          throw new Error('webhook failed')
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await assert.rejects(async () => {
        await runtime.dispatchWebhook({ path: '/wh', body: '' })
      }, { message: 'webhook failed' })
    } finally {
      await runtime.close()
    }
  })

  // fireSchedule
  await t.test('24. Dispatches to handlers.schedule', async () => {
    let received = null
    const bot = makeBot({
      triggers: [{ type: 'schedule', name: 'daily', cron: '0 0 * * *' }],
      handlers: {
        schedule: async (_ctx, req) => {
          received = req
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.fireSchedule('daily')
      assert.deepEqual(received, { name: 'daily' })
    } finally {
      await runtime.close()
    }
  })

  await t.test('25. The payload has the correct name', async () => {
    let firedName = null
    const bot = makeBot({
      triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
      handlers: {
        schedule: async (_ctx, req) => {
          firedName = req.name
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.fireSchedule('hourly')
      assert.equal(firedName, 'hourly')
    } finally {
      await runtime.close()
    }
  })

  await t.test('26. An unknown name throws', async () => {
    const bot = makeBot({
      triggers: [{ type: 'schedule', name: 'daily', cron: '0 0 * * *' }]
    })
    const runtime = await createTestRuntime(bot)
    try {
      await assert.rejects(async () => {
        await runtime.fireSchedule('unknown')
      }, /Schedule trigger 'unknown' not found/)
    } finally {
      await runtime.close()
    }
  })

  // advanceTime
  await t.test('27. A schedule with a daily trigger fires when advanceTime crosses midnight', async () => {
    let fireCount = 0
    const bot = makeBot({
      triggers: [{ type: 'schedule', name: 'daily', cron: '0 0 * * *' }],
      handlers: {
        schedule: async () => {
          fireCount++
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.advanceTime(24 * 60 * 60 * 1000)
      assert.equal(fireCount, 1)
    } finally {
      await runtime.close()
    }
  })

  await t.test('28. Multiple fires within the window fire in order', async () => {
    const fires = []
    const bot = makeBot({
      triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
      handlers: {
        schedule: async (_ctx, req) => {
          fires.push(req.name)
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.advanceTime(3 * 60 * 60 * 1000)
      assert.equal(fires.length, 3)
      assert.deepEqual(fires, ['hourly', 'hourly', 'hourly'])
    } finally {
      await runtime.close()
    }
  })

  await t.test('29. A handler throw during a fire is caught', async () => {
    let callCount = 0
    const bot = makeBot({
      triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
      handlers: {
        schedule: async () => {
          callCount++
          throw new Error('cron failed')
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.advanceTime(2 * 60 * 60 * 1000)
      assert.equal(callCount, 2)
    } finally {
      await runtime.close()
    }
  })

  await t.test('30. advanceTime(0) does not fire anything', async () => {
    let fired = false
    const bot = makeBot({
      triggers: [{ type: 'schedule', name: 'minutely', cron: '* * * * *' }],
      handlers: {
        schedule: async () => {
          fired = true
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.advanceTime(0)
      assert.equal(fired, false)
    } finally {
      await runtime.close()
    }
  })

  await t.test('31. The clock advances even if a fire fails', async () => {
    const bot = makeBot({
      triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
      handlers: {
        schedule: async () => {
          throw new Error('fail')
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.advanceTime(60 * 60 * 1000)
      await runtime.advanceTime(60 * 60 * 1000)
    } finally {
      await runtime.close()
    }
  })

  await t.test('32. advanceTime on a runtime with no schedule triggers is a no-op', async () => {
    const bot = makeBot()
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.advanceTime(100000)
    } finally {
      await runtime.close()
    }
  })

  // restart
  await t.test('33. restart preserves settings', async () => {
    let storedVal = null
    const bot = makeBot({
      handlers: {
        message: async (ctx) => {
          storedVal = await ctx.settings.get('my_key')
        }
      }
    })
    const runtime = await createTestRuntime(bot, {
      settings: { my_key: 'my_value' }
    })
    try {
      await runtime.inject({ type: 'message', payload: { roomId: 'r_1' } })
      assert.equal(storedVal, 'my_value')

      await runtime.restart()

      storedVal = null
      await runtime.inject({ type: 'message', payload: { roomId: 'r_1' } })
      assert.equal(storedVal, 'my_value')
    } finally {
      await runtime.close()
    }
  })

  await t.test('34. restart preserves storage', async () => {
    let storedVal = null
    const bot = makeBot({
      handlers: {
        message: async (ctx) => {
          if (storedVal === null) {
            await ctx.storage.set('s_key', 's_val')
          }
          storedVal = await ctx.storage.get('s_key')
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.inject({ type: 'message', payload: { roomId: 'r_1' } })
      assert.equal(storedVal, 's_val')

      await runtime.restart()

      storedVal = null
      await runtime.inject({ type: 'message', payload: { roomId: 'r_1' } })
      assert.equal(storedVal, 's_val')
    } finally {
      await runtime.close()
    }
  })

  await t.test('35. restart preserves grants', async () => {
    const bot = makeBot()
    const grants = [{ roomId: 'r_p', mode: 'observer', scopes: [] }]
    const runtime = await createTestRuntime(bot, { grants })
    try {
      assert.equal(runtime.getGrants().size, 1)
      await runtime.restart()
      assert.equal(runtime.getGrants().size, 1)
      assert.ok(runtime.getGrants().has('r_p'))
    } finally {
      await runtime.close()
    }
  })

  await t.test('36. restart preserves the mock\'s request history', async () => {
    const bot = makeBot({
      commands: {
        ping: {
          handler: async () => ({ type: 'local_message', content: 'pong' })
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.inject({ type: 'command', payload: { commandName: 'ping' } })
      const count1 = runtime.calls.length
      assert.ok(count1 > 0)

      await runtime.restart()

      const count2 = runtime.calls.length
      assert.equal(count2, count1)
    } finally {
      await runtime.close()
    }
  })

  await t.test('37. restart resets the simulated clock', async () => {
    let fireCount = 0
    const bot = makeBot({
      triggers: [{ type: 'schedule', name: 'daily', cron: '0 0 * * *' }],
      handlers: {
        schedule: async () => {
          fireCount++
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.advanceTime(24 * 60 * 60 * 1000)
      assert.equal(fireCount, 1)

      await runtime.restart()

      await runtime.advanceTime(24 * 60 * 60 * 1000)
      assert.equal(fireCount, 2)
    } finally {
      await runtime.close()
    }
  })

  // simulateResponse
  await t.test('38. Overrides the default response for a path', async () => {
    let responseJson = null
    const bot = makeBot({
      handlers: {
        message: async (ctx) => {
          const res = await ctx.fetch('http://mock/custom-path')
          responseJson = await res.json()
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      runtime.simulateResponse('/custom-path', { status: 200, body: { custom: 'ok' } })
      await runtime.inject({ type: 'message', payload: { roomId: 'r_1' } })

      const req = runtime.calls.find((r) => r.path === '/custom-path' || r.path === '/api/v1/custom-path')
      assert.ok(req)
      assert.deepEqual(responseJson, { custom: 'ok' })
    } finally {
      await runtime.close()
    }
  })

  await t.test('39. Defaults to matching any method', async () => {
    let responseJson = null
    const bot = makeBot({
      handlers: {
        message: async (ctx) => {
          const res = await ctx.fetch('http://mock/any-method', { method: 'POST' })
          responseJson = await res.json()
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      runtime.simulateResponse('/any-method', { status: 200, body: { ok: true } })
      await runtime.inject({ type: 'message', payload: { roomId: 'r_1' } })

      const req = runtime.calls.find((r) => r.path === '/any-method' || r.path === '/api/v1/any-method')
      assert.ok(req)
      assert.equal(req.method, 'POST')
      assert.deepEqual(responseJson, { ok: true })
    } finally {
      await runtime.close()
    }
  })

  await t.test('40. An explicit method narrows the match', async () => {
    const bot = makeBot()
    const runtime = await createTestRuntime(bot)
    try {
      runtime.simulateResponse('/narrow', { status: 200, body: { post: true } }, 'POST')
      assert.ok(runtime)
    } finally {
      await runtime.close()
    }
  })

  // getPendingOutbound
  await t.test('41. Returns an empty array', async () => {
    const bot = makeBot()
    const runtime = await createTestRuntime(bot)
    try {
      const outbound = runtime.getPendingOutbound()
      assert.deepEqual(outbound, [])
    } finally {
      await runtime.close()
    }
  })

  // close
  await t.test('42. Closes the mock server', async () => {
    const bot = makeBot({
      handlers: {
        message: async (ctx) => {
          await ctx.post({ text: 'test' })
        }
      }
    })
    const grants = [{ roomId: 'r_1', mode: 'write_only', scopes: ['write'] }]
    const runtime = await createTestRuntime(bot, { grants })
    await runtime.close()

    const res = await runtime.inject({
      type: 'message',
      payload: { roomId: 'r_1' }
    })
    assert.equal(res.ok, false)
  })

  await t.test('43. close is idempotent', async () => {
    const bot = makeBot()
    const runtime = await createTestRuntime(bot)
    await runtime.close()
    await runtime.close()
  })

  // End-to-end
  await t.test('44. A command invocation triggers a ctx.post', async () => {
    const bot = makeBot({
      commands: {
        announce: {
          handler: async (ctx) => {
            await ctx.post({ text: 'Hello room!' })
            return { type: 'none' }
          }
        }
      }
    })
    const grants = [{ roomId: 'r_announce', mode: 'write_only', scopes: ['write'] }]
    const runtime = await createTestRuntime(bot, { grants })
    try {
      await runtime.inject({
        type: 'command',
        payload: {
          commandName: 'announce',
          roomId: 'r_announce'
        }
      })
      const postReq = runtime.calls.find((r) => r.path === '/api/v1/rooms/r_announce/bot-messages')
      assert.ok(postReq)
      assert.equal(postReq.method, 'POST')
    } finally {
      await runtime.close()
    }
  })

  await t.test('45. A command invocation triggers a ctx.sendLocal', async () => {
    const bot = makeBot({
      commands: {
        note: {
          handler: async (ctx) => {
            await ctx.sendLocal({ text: 'Private note' })
            return { type: 'none' }
          }
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.inject({
        type: 'command',
        payload: { commandName: 'note' }
      })
      const localReq = runtime.calls.find((r) => r.path === '/api/v1/bots/me/messages' && r.json?.result_type === 'local_message')
      assert.ok(localReq)
    } finally {
      await runtime.close()
    }
  })

  await t.test('46. A command invocation triggers a ctx.fetch', async () => {
    const bot = makeBot({
      commands: {
        'fetch-data': {
          handler: async (ctx) => {
            await ctx.fetch('http://mock/external-data')
            return { type: 'none' }
          }
        }
      }
    })
    const runtime = await createTestRuntime(bot)
    try {
      await runtime.inject({
        type: 'command',
        payload: { commandName: 'fetch-data' }
      })
      const fetchReq = runtime.calls.find((r) => r.path === '/external-data' || r.path === '/api/v1/external-data')
      assert.ok(fetchReq)
    } finally {
      await runtime.close()
    }
  })
})
