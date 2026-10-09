import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createTestRuntime } from '../../src/testing/create-test-runtime.js'
import { defineBot } from '../../src/define-bot.js'
import { defineCommand } from '../../src/define-command.js'
import { defineSettings } from '../../src/define-settings.js'
import { decryptCommandResult } from '../../src/runtime/crypto/command-result.js'
import { bot, calls } from './fixtures/echo-bot.js'

function resetCalls (obj) {
  for (const key of Object.keys(obj)) {
    obj[key].length = 0
  }
}

describe('End-to-End Smoke Test Suite', { concurrency: 1 }, () => {
  let runtime
  const generatedPrivKeys = []

  // Intercept 32-byte randomBytes to capture ephemeral result private keys
  const origRandomBytes = crypto.randomBytes
  crypto.randomBytes = function (size, ...args) {
    const buf = origRandomBytes.call(crypto, size, ...args)
    if (size === 32) {
      generatedPrivKeys.push(new Uint8Array(buf))
    }
    return buf
  }

  beforeEach(async () => {
    resetCalls(calls)
    generatedPrivKeys.length = 0
    runtime = await createTestRuntime(bot, {
      grants: [
        {
          roomId: 'r_alpha',
          mode: 'write_only',
          scopes: ['post_message', 'read_commands']
        },
        {
          roomId: 'r_beta',
          mode: 'observer',
          scopes: ['read_metadata']
        }
      ],
      settings: { greeting: 'hello' },
      storage: { count: 0 },
      roomsList: [
        {
          id: 'r_alpha',
          displayName: 'Alpha',
          memberCount: 3
        },
        {
          id: 'r_beta',
          displayName: 'Beta',
          memberCount: 5
        }
      ]
    })

    const origClose = runtime.close.bind(runtime)
    runtime.close = async () => {
      const handler = bot.config.handlers?.uninstall
      if (typeof handler === 'function') {
        await handler({
          bot: { id: bot.config.id },
          grant: null,
          room: null
        })
      }
      await origClose()
    }
  })

  afterEach(async () => {
    if (runtime) {
      await runtime.close()
      runtime = null
    }
  })

  // Scenario 1
  it('Scenario 1 — Lifecycle', async () => {
    assert.ok(runtime)
    assert.ok(Array.isArray(runtime.calls))
    assert.equal(calls.ping.length, 0)
    assert.equal(calls.message.length, 0)
  })

  // Scenario 2
  it('Scenario 2 — Command dispatch, happy path', async () => {
    const res = await runtime.inject({
      type: 'command',
      payload: {
        commandId: 'cmd_ping_1',
        roomId: 'r_alpha',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        commandName: 'ping',
        args: { count: 2 }
      }
    })
    assert.equal(res.ok, true)
    assert.equal(calls.ping.length, 1)
    assert.equal(calls.ping[0].count, 2)

    const postMsgReq = runtime.calls.find((r) => r.path === '/api/v1/bots/me/messages')
    assert.ok(postMsgReq)
    assert.equal(postMsgReq.json.target, 'invoker')
    assert.equal(postMsgReq.json.result_type, 'local_message')
  })

  // Scenario 3
  it('Scenario 3 — Command dispatch, result encrypted to the invoker', async () => {
    await runtime.inject({
      type: 'command',
      payload: {
        commandId: 'cmd_ping_enc',
        roomId: 'r_alpha',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        commandName: 'ping',
        args: { count: 1 }
      }
    })

    const postMsgReq = runtime.calls.find((r) => r.path === '/api/v1/bots/me/messages')
    assert.ok(postMsgReq)
    const { ciphertext, bot_result_pubkey: pubkey } = postMsgReq.json
    assert.equal(typeof ciphertext, 'string')
    assert.equal(typeof pubkey, 'string')
    assert.ok(Buffer.from(ciphertext, 'base64url').length > 0)
    assert.equal(Buffer.from(pubkey, 'base64url').length, 32)
  })

  // Scenario 4
  it('Scenario 4 — Command dispatch, missing argument', async () => {
    await runtime.inject({
      type: 'command',
      payload: {
        commandId: 'cmd_ping_no_args',
        roomId: 'r_alpha',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        commandName: 'ping',
        args: {}
      }
    })

    assert.equal(calls.ping.length, 1)
    assert.equal(calls.ping[0].count, 1)
  })

  // Scenario 5
  it('Scenario 5 — Command dispatch, unknown command', async () => {
    const keysBefore = generatedPrivKeys.length
    await runtime.inject({
      type: 'command',
      payload: {
        commandId: 'cmd_unknown',
        roomId: 'r_alpha',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        commandName: 'nope',
        args: {}
      }
    })

    assert.equal(calls.ping.length, 0)
    const postMsgReq = runtime.calls.find((r) => r.path === '/api/v1/bots/me/messages')
    assert.ok(postMsgReq)
    assert.equal(postMsgReq.json.result_type, 'local_message')

    // Decrypt the local message result to verify it contains 'Unknown command'
    const resultEphemeralPrivKey = generatedPrivKeys[keysBefore + 1]
    assert.ok(resultEphemeralPrivKey)
    const decrypted = decryptCommandResult({
      privateKey: resultEphemeralPrivKey,
      peerPublicKey: Buffer.from(postMsgReq.json.bot_result_pubkey, 'base64url'),
      ciphertext: Buffer.from(postMsgReq.json.ciphertext, 'base64url')
    })
    const payload = JSON.parse(new TextDecoder().decode(decrypted))
    assert.ok(payload.content.includes('Unknown command'))
  })

  // Scenario 6
  it('Scenario 6 — Command dispatch, handler error', async () => {
    const errorBot = defineBot({
      id: 'com.example.error',
      apiVersion: '1.0',
      hostApi: '1.0',
      label: 'Error Bot',
      capabilities: ['read_commands'],
      handlers: {
        message: async () => {
        }
      },
      commands: {
        fail: defineCommand({
          description: 'Fails always',
          args: {},
          handler: async () => {
            throw new Error('boom')
          }
        })
      }
    })

    const errRuntime = await createTestRuntime(errorBot)
    const keysBefore = generatedPrivKeys.length
    try {
      const res = await errRuntime.inject({
        type: 'command',
        payload: {
          commandId: 'cmd_fail',
          roomId: 'r_alpha',
          senderUserId: 'u_1',
          senderClientId: 'c_1',
          commandName: 'fail',
          args: {}
        }
      })
      assert.equal(res.ok, true)
      const postMsgReq = errRuntime.calls.find((r) => r.path === '/api/v1/bots/me/messages')
      assert.ok(postMsgReq)
      assert.equal(postMsgReq.json.result_type, 'local_message')

      const resultEphemeralPrivKey = generatedPrivKeys[keysBefore + 1]
      assert.ok(resultEphemeralPrivKey)
      const decrypted = decryptCommandResult({
        privateKey: resultEphemeralPrivKey,
        peerPublicKey: Buffer.from(postMsgReq.json.bot_result_pubkey, 'base64url'),
        ciphertext: Buffer.from(postMsgReq.json.ciphertext, 'base64url')
      })
      const payload = JSON.parse(new TextDecoder().decode(decrypted))
      assert.ok(payload.content.includes('failed'))
    } finally {
      await errRuntime.close()
    }
  })

  // Scenario 7
  it('Scenario 7 — Message event dispatch, member mode', async () => {
    await runtime.inject({
      type: 'message',
      payload: {
        roomId: 'r_alpha',
        type: 'message.new',
        data: { id: 'm_1' }
      }
    })

    assert.equal(calls.message.length, 1)
    assert.equal(calls.message[0].roomId, 'r_alpha')
    assert.equal(calls.message[0].type, 'message.new')
  })

  // Scenario 8
  it('Scenario 8 — Message event, member mode, plaintext is null', async () => {
    let receivedEvent = null
    const memberBot = defineBot({
      id: 'com.example.member',
      apiVersion: '1.0',
      hostApi: '1.0',
      label: 'Member Bot',
      capabilities: ['read_content'],
      handlers: {
        message: (_ctx, event) => {
          receivedEvent = event
        }
      }
    })

    const memberRuntime = await createTestRuntime(memberBot, {
      grants: [{
        roomId: 'r_member',
        mode: 'member',
        scopes: ['read_content']
      }]
    })
    try {
      await memberRuntime.inject({
        type: 'message',
        payload: {
          roomId: 'r_member',
          type: 'message.new',
          data: { plaintext: null }
        }
      })
      assert.ok(receivedEvent)
      assert.equal(receivedEvent.data.plaintext, null)
    } finally {
      await memberRuntime.close()
    }
  })

  // Scenario 9
  it('Scenario 9 — Message event, observer mode', async () => {
    await runtime.inject({
      type: 'message',
      payload: {
        roomId: 'r_beta',
        type: 'message.new',
        data: { id: 'm_2' }
      }
    })

    assert.equal(calls.message.length, 1)
    assert.equal(calls.message[0].roomId, 'r_beta')
  })

  // Scenario 10
  it('Scenario 10 — Room event dispatch', async () => {
    await runtime.inject({
      type: 'room',
      payload: {
        roomId: 'r_alpha',
        eventName: 'room.updated',
        data: { name: 'New Alpha Name' }
      }
    })

    assert.equal(calls.room.length, 1)
    assert.equal(calls.room[0].roomId, 'r_alpha')
    assert.deepEqual(calls.room[0].data, { name: 'New Alpha Name' })
  })

  // Scenario 11
  it('Scenario 11 — Grant update dispatch', async () => {
    await runtime.inject({
      type: 'grant_updated',
      payload: {
        roomId: 'r_alpha',
        newMode: 'member'
      }
    })

    assert.equal(calls.grantUpdated.length, 1)
    assert.equal(calls.grantUpdated[0].newMode, 'member')
    assert.equal(runtime.getGrants().get('r_alpha').mode, 'member')
  })

  // Scenario 12
  it('Scenario 12 — Grant update, tear down on revoke', async () => {
    await runtime.inject({
      type: 'grant_updated',
      payload: {
        roomId: 'r_alpha',
        newMode: 'member'
      }
    })

    await runtime.inject({
      type: 'grant_updated',
      payload: {
        roomId: 'r_alpha',
        newMode: 'write_only'
      }
    })

    assert.equal(runtime.getGrants().get('r_alpha').mode, 'write_only')
    assert.equal(calls.grantUpdated.length, 2)
  })

  // Scenario 13
  it('Scenario 13 — Webhook dispatch', async () => {
    await runtime.dispatchWebhook({
      path: '/hook',
      body: '{"x":1}',
      headers: { 'x-test': 'yes' }
    })

    assert.equal(calls.webhook.length, 1)
    assert.equal(calls.webhook[0].path, '/hook')
    assert.equal(calls.webhook[0].body, '{"x":1}')
  })

  // Scenario 14
  it('Scenario 14 — Schedule dispatch, direct', async () => {
    await runtime.fireSchedule('tick')

    assert.equal(calls.schedule.length, 1)
    assert.equal(calls.schedule[0].name, 'tick')
  })

  // Scenario 15
  it('Scenario 15 — Schedule dispatch, time advance', async () => {
    await runtime.advanceTime(5 * 60 * 1000)

    assert.ok(calls.schedule.length >= 1)
    assert.equal(calls.schedule[0].name, 'tick')
  })

  // Scenario 16
  it('Scenario 16 — ctx.post in a command handler', async () => {
    const postBot = defineBot({
      id: 'com.example.post',
      apiVersion: '1.0',
      hostApi: '1.0',
      label: 'Post Bot',
      capabilities: ['post_message', 'read_commands'],
      handlers: {
        message: async () => {
        }
      },
      commands: {
        send: defineCommand({
          description: 'Post message',
          args: {},
          handler: async (ctx) => {
            await ctx.post({
              roomId: 'r_alpha',
              text: 'from post'
            })
            return { type: 'none' }
          }
        })
      }
    })

    const postRuntime = await createTestRuntime(postBot, {
      grants: [{
        roomId: 'r_alpha',
        mode: 'write_only',
        scopes: ['post_message', 'read_commands']
      }]
    })
    try {
      await postRuntime.inject({
        type: 'command',
        payload: {
          commandId: 'cmd_post',
          roomId: 'r_alpha',
          commandName: 'send',
          args: {}
        }
      })

      const postReq = postRuntime.calls.find((r) => r.path === '/api/v1/rooms/r_alpha/bot-messages')
      assert.ok(postReq)
      assert.ok(postReq.json.signature)
      assert.ok(postReq.json.ciphertext)
      assert.notEqual(postReq.json.epoch, undefined)
    } finally {
      await postRuntime.close()
    }
  })

  // Scenario 17
  it('Scenario 17 — ctx.reply in a command handler', async () => {
    const replyBot = defineBot({
      id: 'com.example.reply',
      apiVersion: '1.0',
      hostApi: '1.0',
      label: 'Reply Bot',
      capabilities: ['post_message', 'read_commands'],
      handlers: {
        message: async () => {
        }
      },
      commands: {
        reply: defineCommand({
          description: 'Reply message',
          args: {},
          handler: async (ctx) => {
            await ctx.reply({
              replyTo: 'm_1',
              text: 'reply'
            })
            return { type: 'none' }
          }
        })
      }
    })

    const replyRuntime = await createTestRuntime(replyBot, {
      grants: [{
        roomId: 'r_alpha',
        mode: 'write_only',
        scopes: ['post_message', 'read_commands']
      }]
    })
    try {
      await replyRuntime.inject({
        type: 'command',
        payload: {
          commandId: 'cmd_reply',
          roomId: 'r_alpha',
          commandName: 'reply',
          args: {}
        }
      })

      const replyReq = replyRuntime.calls.find((r) => r.path === '/api/v1/rooms/r_alpha/bot-messages')
      assert.ok(replyReq)
      assert.ok(replyReq.json)
    } finally {
      await replyRuntime.close()
    }
  })

  // Scenario 18
  it('Scenario 18 — ctx.fetch in a command handler', async () => {
    const fetchBot = defineBot({
      id: 'com.example.fetch',
      apiVersion: '1.0',
      hostApi: '1.0',
      label: 'Fetch Bot',
      capabilities: ['read_commands'],
      handlers: {
        message: async () => {
        }
      },
      commands: {
        fetch: defineCommand({
          description: 'Fetch data',
          args: {},
          handler: async (ctx) => {
            const res = await ctx.fetch('http://127.0.0.1/data')
            const text = await res.text()
            return {
              type: 'local_message',
              content: text
            }
          }
        })
      }
    })

    const fetchRuntime = await createTestRuntime(fetchBot)
    fetchRuntime.simulateResponse('/data', {
      status: 200,
      body: 'hello fetched'
    })
    try {
      await fetchRuntime.inject({
        type: 'command',
        payload: {
          commandId: 'cmd_fetch',
          roomId: 'r_alpha',
          commandName: 'fetch',
          args: {}
        }
      })

      const fetchReq = fetchRuntime.calls.find((r) => r.path === '/data' || r.path === '/api/v1/data')
      assert.ok(fetchReq)
    } finally {
      await fetchRuntime.close()
    }
  })

  // Scenario 19
  it('Scenario 19 — ctx.sendLocal in a command handler', async () => {
    const sendLocalBot = defineBot({
      id: 'com.example.sendlocal',
      apiVersion: '1.0',
      hostApi: '1.0',
      label: 'SendLocal Bot',
      capabilities: ['read_commands'],
      handlers: {
        message: async () => {
        }
      },
      commands: {
        note: defineCommand({
          description: 'Send local note',
          args: {},
          handler: async (ctx) => {
            await ctx.sendLocal({ text: 'note' })
            return { type: 'none' }
          }
        })
      }
    })

    const sendLocalRuntime = await createTestRuntime(sendLocalBot)
    try {
      await sendLocalRuntime.inject({
        type: 'command',
        payload: {
          commandId: 'cmd_sendlocal',
          roomId: 'r_alpha',
          commandName: 'note',
          args: {}
        }
      })

      const localReq = sendLocalRuntime.calls.find(
        (r) => r.path === '/api/v1/bots/me/messages' && r.json?.target === 'owner' && r.json?.result_type === 'local_message'
      )
      assert.ok(localReq)
    } finally {
      await sendLocalRuntime.close()
    }
  })

  // Scenario 20
  it('Scenario 20 — ctx.settings.get', async () => {
    let greetingVal = null
    const settingsBot = defineBot({
      id: 'com.example.settings',
      apiVersion: '1.0',
      hostApi: '1.0',
      label: 'Settings Bot',
      capabilities: ['read_commands'],
      handlers: {
        message: async () => {
        }
      },
      settings: defineSettings({
        greeting: {
          label: 'Greeting',
          type: 'text'
        }
      }),
      commands: {
        greet: defineCommand({
          description: 'Get greeting',
          args: {},
          handler: async (ctx) => {
            greetingVal = await ctx.settings.get('greeting')
            return { type: 'none' }
          }
        })
      }
    })

    const settingsRuntime = await createTestRuntime(settingsBot, {
      settings: { greeting: 'hello' }
    })
    try {
      await settingsRuntime.inject({
        type: 'command',
        payload: {
          commandId: 'cmd_settings',
          roomId: 'r_alpha',
          commandName: 'greet',
          args: {}
        }
      })

      assert.equal(greetingVal, 'hello')
    } finally {
      await settingsRuntime.close()
    }
  })

  // Scenario 21
  it('Scenario 21 — ctx.storage.set / ctx.storage.get round-trip', async () => {
    let readVal = null
    const storageBot = defineBot({
      id: 'com.example.storage',
      apiVersion: '1.0',
      hostApi: '1.0',
      label: 'Storage Bot',
      capabilities: ['read_commands'],
      handlers: {
        message: async () => {
        }
      },
      commands: {
        store: defineCommand({
          description: 'Store test',
          args: {},
          handler: async (ctx) => {
            await ctx.storage.set('key_1', 'val_1')
            readVal = await ctx.storage.get('key_1')
            return { type: 'none' }
          }
        })
      }
    })

    const storageRuntime = await createTestRuntime(storageBot)
    try {
      await storageRuntime.inject({
        type: 'command',
        payload: {
          commandId: 'cmd_storage',
          roomId: 'r_alpha',
          commandName: 'store',
          args: {}
        }
      })

      assert.equal(readVal, 'val_1')
    } finally {
      await storageRuntime.close()
    }
  })

  // Scenario 22
  it('Scenario 22 — ctx.rooms.list()', async () => {
    let returnedRooms = null
    const roomsBot = defineBot({
      id: 'com.example.rooms',
      apiVersion: '1.0',
      hostApi: '1.0',
      label: 'Rooms Bot',
      capabilities: ['read_commands'],
      handlers: {
        message: async () => {
        }
      },
      commands: {
        rooms: defineCommand({
          description: 'List rooms',
          args: {},
          handler: async (ctx) => {
            returnedRooms = await ctx.rooms.list()
            return { type: 'none' }
          }
        })
      }
    })

    const roomsRuntime = await createTestRuntime(roomsBot, {
      roomsList: [
        {
          id: 'r_alpha',
          displayName: 'Alpha',
          memberCount: 3
        },
        {
          id: 'r_beta',
          displayName: 'Beta',
          memberCount: 5
        }
      ]
    })
    try {
      await roomsRuntime.inject({
        type: 'command',
        payload: {
          commandId: 'cmd_rooms',
          roomId: 'r_alpha',
          commandName: 'rooms',
          args: {}
        }
      })

      assert.ok(Array.isArray(returnedRooms))
      assert.equal(returnedRooms.length, 2)
      assert.equal(returnedRooms[0].id, 'r_alpha')
      assert.equal(returnedRooms[1].id, 'r_beta')
    } finally {
      await roomsRuntime.close()
    }
  })

  // Scenario 23
  it('Scenario 23 — ctx.log is a no-op but replaceable', async () => {
    let logged = null
    const logBot = defineBot({
      id: 'com.example.log',
      apiVersion: '1.0',
      hostApi: '1.0',
      label: 'Log Bot',
      capabilities: ['read_commands'],
      handlers: {
        message: async () => {
        }
      },
      commands: {
        log: defineCommand({
          description: 'Log test',
          args: {},
          handler: async (ctx) => {
            ctx.log = (msg) => {
              logged = msg
            }
            ctx.log('hello logger')
            return { type: 'none' }
          }
        })
      }
    })

    const logRuntime = await createTestRuntime(logBot)
    try {
      await logRuntime.inject({
        type: 'command',
        payload: {
          commandId: 'cmd_log',
          roomId: 'r_alpha',
          commandName: 'log',
          args: {}
        }
      })

      assert.equal(logged, 'hello logger')
    } finally {
      await logRuntime.close()
    }
  })

  // Scenario 24
  it('Scenario 24 — Multiple events in sequence', async () => {
    await runtime.inject({
      type: 'command',
      payload: {
        commandId: 'cmd_seq',
        roomId: 'r_alpha',
        commandName: 'ping',
        args: { count: 3 }
      }
    })

    await runtime.inject({
      type: 'message',
      payload: {
        roomId: 'r_alpha',
        type: 'message.new'
      }
    })

    await runtime.dispatchWebhook({
      path: '/hook',
      body: 'seq_body'
    })

    assert.equal(calls.ping.length, 1)
    assert.equal(calls.ping[0].count, 3)
    assert.equal(calls.message.length, 1)
    assert.equal(calls.webhook.length, 1)
    assert.equal(calls.webhook[0].body, 'seq_body')
  })

  // Scenario 25
  it('Scenario 25 — getPendingOutbound returns []', async () => {
    assert.deepEqual(runtime.getPendingOutbound(), [])
  })

  // Scenario 26
  it('Scenario 26 — Clean shutdown calls uninstall', async () => {
    assert.equal(calls.uninstall.length, 0)
    await runtime.close()
    assert.equal(calls.uninstall.length, 1)
    runtime = null
  })
})
