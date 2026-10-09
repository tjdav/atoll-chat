import test from 'node:test'
import assert from 'node:assert/strict'
import { sendMessage } from '../../src/lib/views/send-message.js'

function makeDeps() {
  const calls = {
    messagesUpsert: [],
    outboxEnqueue: [],
    readStateUpsert: [],
    metaGet: [],
    metaSet: []
  }
  let existingClientId = null
  let listAppMessages = []

  const deps = {
    repos: {
      messages: {
        listApplicationsInRoom: async () => listAppMessages,
        upsert: async (msg) => {
          calls.messagesUpsert.push(msg)
          return { changes: 1 }
        }
      },
      outbox: {
        enqueue: async (args) => {
          calls.outboxEnqueue.push(args)
          return { changes: 1 }
        }
      },
      readState: {
        upsert: async (args) => {
          calls.readStateUpsert.push(args)
          return { changes: 1 }
        }
      }
    },
    storage: {
      meta: {
        get: async (k) => {
          calls.metaGet.push(k)
          return existingClientId
        },
        set: async (k, v) => {
          calls.metaSet.push({ k, v })
          if (k === 'client_id') existingClientId = v
        }
      }
    },
    globalStore: {
      $state: { currentUser: { id: 'u_me' } }
    },
    crypto: {
      randomUUID: () => 'fake-uuid-1234'
    }
  }

  return { deps, calls, setExistingClientId: (v) => { existingClientId = v }, setListAppMessages: (msgs) => { listAppMessages = msgs } }
}

test('sendMessage empty text returns skipped', async () => {
  const { deps, calls } = makeDeps()
  const res = await sendMessage({ deps, roomId: 'r_1', text: '' })
  assert.deepEqual(res, { skipped: true, reason: 'empty' })
  assert.equal(calls.messagesUpsert.length, 0)
})

test('sendMessage whitespace text returns skipped', async () => {
  const { deps, calls } = makeDeps()
  const res = await sendMessage({ deps, roomId: 'r_1', text: '   ' })
  assert.deepEqual(res, { skipped: true, reason: 'empty' })
  assert.equal(calls.messagesUpsert.length, 0)
})

test('sendMessage no current user returns skipped', async () => {
  const { deps, calls } = makeDeps()
  deps.globalStore.$state.currentUser = null
  const res = await sendMessage({ deps, roomId: 'r_1', text: 'hello' })
  assert.deepEqual(res, { skipped: true, reason: 'no-user' })
  assert.equal(calls.messagesUpsert.length, 0)
})

test('sendMessage happy path creates local message record', async () => {
  const { deps, calls } = makeDeps()
  const res = await sendMessage({ deps, roomId: 'r_1', text: 'hello' })
  assert.equal(res.skipped, false)
  assert.equal(res.messageId, 'local_fake-uuid-1234')
  assert.equal(calls.messagesUpsert.length, 1)

  const msg = calls.messagesUpsert[0]
  assert.equal(msg.messageId, 'local_fake-uuid-1234')
  assert.equal(msg.roomId, 'r_1')
  assert.equal(msg.senderUserId, 'u_me')
  assert.equal(msg.contentType, 'application')
  assert.equal(msg.localStatus, 'pending')
})

test('sendMessage generates and stores client_id on cold boot', async () => {
  const { deps, calls } = makeDeps()
  await sendMessage({ deps, roomId: 'r_1', text: 'hello' })
  assert.deepEqual(calls.metaGet, ['client_id'])
  assert.equal(calls.metaSet.length, 1)
  assert.equal(calls.metaSet[0].k, 'client_id')
  assert.equal(calls.metaSet[0].v, 'local_fake-uuid-1234')
})

test('sendMessage reuses existing client_id', async () => {
  const { deps, calls, setExistingClientId } = makeDeps()
  setExistingClientId('existing-client-99')
  await sendMessage({ deps, roomId: 'r_1', text: 'hello' })
  assert.deepEqual(calls.metaGet, ['client_id'])
  assert.equal(calls.metaSet.length, 0)
})

test('sendMessage enqueues message in outbox', async () => {
  const { deps, calls } = makeDeps()
  await sendMessage({ deps, roomId: 'r_1', text: 'hello' })
  assert.equal(calls.outboxEnqueue.length, 1)
  assert.deepEqual(calls.outboxEnqueue[0], {
    messageId: 'local_fake-uuid-1234',
    roomId: 'r_1'
  })
})

test('sendMessage advances sender read state', async () => {
  const { deps, calls } = makeDeps()
  await sendMessage({ deps, roomId: 'r_1', text: 'hello' })
  assert.equal(calls.readStateUpsert.length, 1)
  const rs = calls.readStateUpsert[0]
  assert.equal(rs.userId, 'u_me')
  assert.equal(rs.roomId, 'r_1')
  assert.equal(rs.lastReadMessageId, 'local_fake-uuid-1234')
  assert.ok(typeof rs.lastReadAt === 'number')
})

test('sendMessage computes epoch 0 seq 1 when room empty', async () => {
  const { deps, calls } = makeDeps()
  await sendMessage({ deps, roomId: 'r_1', text: 'hello' })
  assert.equal(calls.messagesUpsert[0].epoch, 0)
  assert.equal(calls.messagesUpsert[0].seq, 1)
})

test('sendMessage bumps sequence from newest message', async () => {
  const { deps, calls, setListAppMessages } = makeDeps()
  setListAppMessages([{ epoch: 2, seq: 5 }])
  await sendMessage({ deps, roomId: 'r_1', text: 'hello' })
  assert.equal(calls.messagesUpsert[0].epoch, 2)
  assert.equal(calls.messagesUpsert[0].seq, 6)
})

test('sendMessage ciphertext starts with stub: marker', async () => {
  const { deps, calls } = makeDeps()
  await sendMessage({ deps, roomId: 'r_1', text: 'hello' })
  const ct = calls.messagesUpsert[0].ciphertext
  const decoder = new TextDecoder()
  const prefix = decoder.decode(ct.subarray(0, 5))
  assert.equal(prefix, 'stub:')
})

test('sendMessage decryptedPayload is valid JSON string', async () => {
  const { deps, calls } = makeDeps()
  await sendMessage({ deps, roomId: 'r_1', text: 'hello' })
  const payloadStr = calls.messagesUpsert[0].decryptedPayload
  const parsed = JSON.parse(payloadStr)
  assert.deepEqual(parsed, { type: 'text', text: 'hello' })
})

test('sendMessage error in messages.upsert propagates and halts flow', async () => {
  const { deps, calls } = makeDeps()
  deps.repos.messages.upsert = async () => {
    throw new Error('DB write failed')
  }
  await assert.rejects(
    () => sendMessage({ deps, roomId: 'r_1', text: 'hello' }),
    { message: 'DB write failed' }
  )
  assert.equal(calls.outboxEnqueue.length, 0)
  assert.equal(calls.readStateUpsert.length, 0)
})

test('sendMessage error in outbox.enqueue propagates', async () => {
  const { deps, calls } = makeDeps()
  deps.repos.outbox.enqueue = async () => {
    throw new Error('Outbox enqueue failed')
  }
  await assert.rejects(
    () => sendMessage({ deps, roomId: 'r_1', text: 'hello' }),
    { message: 'Outbox enqueue failed' }
  )
  assert.equal(calls.readStateUpsert.length, 0)
})
