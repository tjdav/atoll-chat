import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isEditAvailable, editMessage } from '../../src/lib/views/edit-message.js'
import { buildTextPayload, encodePayload, encodeCiphertextStub } from '../../src/lib/composer/index.js'

describe('isEditAvailable', () => {
  it('1. returns false if message is null/undefined', () => {
    assert.equal(isEditAvailable(null, 'u_me'), false)
    assert.equal(isEditAvailable(undefined, 'u_me'), false)
  })

  it('2. returns false for non-sender', () => {
    const msg = { sender_user_id: 'u_alice', created_at: 1000, local_status: 'sent' }
    assert.equal(isEditAvailable(msg, 'u_me', { now: 1000 }), false)
  })

  it('3. returns false for pending message from sender', () => {
    const msg = { sender_user_id: 'u_me', created_at: 1000, local_status: 'pending' }
    assert.equal(isEditAvailable(msg, 'u_me', { now: 1000 }), false)
  })

  it('4. returns false for tombstoned message from sender', () => {
    const msg = { sender_user_id: 'u_me', created_at: 1000, local_status: 'sent', deleted_at: 2000 }
    assert.equal(isEditAvailable(msg, 'u_me', { now: 1000 }), false)
  })

  it('5. returns false for own sent message older than 15 minutes', () => {
    const msg = { sender_user_id: 'u_me', created_at: 1000, local_status: 'sent' }
    const windowMs = 15 * 60 * 1000
    assert.equal(isEditAvailable(msg, 'u_me', { windowMs, now: 1000 + windowMs + 1 }), false)
  })

  it('6. returns true for own sent message at 15 minute boundary', () => {
    const msg = { sender_user_id: 'u_me', created_at: 1000, local_status: 'sent' }
    const windowMs = 15 * 60 * 1000
    assert.equal(isEditAvailable(msg, 'u_me', { windowMs, now: 1000 + windowMs }), true)
  })

  it('7. returns true for own sent message within window', () => {
    const msg = { sender_user_id: 'u_me', created_at: 1000, local_status: 'sent' }
    assert.equal(isEditAvailable(msg, 'u_me', { now: 1000 + 5000 }), true)
  })
})

describe('editMessage', () => {
  function makeMockRepos() {
    const messages = new Map()
    const versions = new Map() // messageId -> Map(editSequence -> versionRecord)
    let throwErrorOnUpsertVersion = false

    return {
      messages: {
        get: async (id) => messages.get(id) ?? null,
        upsert: async (msg) => {
          messages.set(msg.message_id, msg)
          return msg
        },
        listVersions: async (id) => {
          const m = versions.get(id)
          if (!m) return []
          return Array.from(m.values())
        },
        upsertVersion: async (v) => {
          if (throwErrorOnUpsertVersion) throw new Error('DB version error')
          if (!versions.has(v.messageId)) versions.set(v.messageId, new Map())
          versions.get(v.messageId).set(v.editSequence, {
            message_id: v.messageId,
            edit_sequence: v.editSequence,
            ciphertext: v.ciphertext,
            decrypted_payload: v.decryptedPayload,
            edited_at: v.editedAt
          })
        }
      },
      _messagesMap: messages,
      _versionsMap: versions,
      _setThrowErrorOnUpsertVersion: (val) => { throwErrorOnUpsertVersion = val }
    }
  }

  const depsBase = {
    buildTextPayload,
    encodePayload,
    encodeCiphertextStub
  }

  it('8. returns { edited: false, reason: "not-found" } on unknown id', async () => {
    const repos = makeMockRepos()
    const res = await editMessage({
      deps: { ...depsBase, repos },
      messageId: 'm_unknown',
      newText: 'Hello',
      userId: 'u_me'
    })
    assert.deepEqual(res, { edited: false, reason: 'not-found' })
  })

  it('9. returns { edited: false, reason: "not-editable" } on non-editable message', async () => {
    const repos = makeMockRepos()
    repos._messagesMap.set('m_1', {
      message_id: 'm_1',
      sender_user_id: 'u_other',
      created_at: 1000,
      local_status: 'sent'
    })

    const res = await editMessage({
      deps: { ...depsBase, repos },
      messageId: 'm_1',
      newText: 'Hello',
      userId: 'u_me'
    })
    assert.deepEqual(res, { edited: false, reason: 'not-editable' })
  })

  it('10. returns { edited: false, reason: "empty" } with empty text', async () => {
    const repos = makeMockRepos()
    repos._messagesMap.set('m_1', {
      message_id: 'm_1',
      sender_user_id: 'u_me',
      created_at: 1000,
      local_status: 'sent'
    })

    const res = await editMessage({
      deps: { ...depsBase, repos },
      messageId: 'm_1',
      newText: '   ',
      userId: 'u_me',
      now: 2000
    })
    assert.deepEqual(res, { edited: false, reason: 'empty' })
  })

  it('11. writes version 0 and version 1 on first edit', async () => {
    const repos = makeMockRepos()
    repos._messagesMap.set('m_1', {
      message_id: 'm_1',
      sender_user_id: 'u_me',
      created_at: 1000,
      local_status: 'sent',
      ciphertext: new Uint8Array([1, 2, 3]),
      decrypted_payload: '{"type":"text","text":"Original"}'
    })

    const res = await editMessage({
      deps: { ...depsBase, repos },
      messageId: 'm_1',
      newText: 'Updated text',
      userId: 'u_me',
      now: 2000
    })

    assert.deepEqual(res, { edited: true, editSequence: 1 })

    const vList = await repos.messages.listVersions('m_1')
    assert.equal(vList.length, 2)
    assert.equal(vList[0].edit_sequence, 0)
    assert.equal(vList[0].decrypted_payload, '{"type":"text","text":"Original"}')
    assert.equal(vList[0].edited_at, 1000)

    assert.equal(vList[1].edit_sequence, 1)
    assert.equal(vList[1].decrypted_payload, '{"type":"text","text":"Updated text"}')
    assert.equal(vList[1].edited_at, 2000)
  })

  it('12. writes version 2 on second edit without rewriting version 0', async () => {
    const repos = makeMockRepos()
    repos._messagesMap.set('m_1', {
      message_id: 'm_1',
      sender_user_id: 'u_me',
      created_at: 1000,
      local_status: 'sent',
      ciphertext: new Uint8Array([1, 2, 3]),
      decrypted_payload: '{"type":"text","text":"V1 text"}'
    })
    await repos.messages.upsertVersion({
      messageId: 'm_1',
      editSequence: 0,
      ciphertext: new Uint8Array([1, 2, 3]),
      decryptedPayload: '{"type":"text","text":"V0 text"}',
      editedAt: 1000
    })
    await repos.messages.upsertVersion({
      messageId: 'm_1',
      editSequence: 1,
      ciphertext: new Uint8Array([1, 2, 3]),
      decryptedPayload: '{"type":"text","text":"V1 text"}',
      editedAt: 2000
    })

    const res = await editMessage({
      deps: { ...depsBase, repos },
      messageId: 'm_1',
      newText: 'V2 text',
      userId: 'u_me',
      now: 3000
    })

    assert.deepEqual(res, { edited: true, editSequence: 2 })

    const vList = await repos.messages.listVersions('m_1')
    assert.equal(vList.length, 3)
    assert.equal(vList[0].decrypted_payload, '{"type":"text","text":"V0 text"}')
    assert.equal(vList[2].edit_sequence, 2)
    assert.equal(vList[2].decrypted_payload, '{"type":"text","text":"V2 text"}')
  })

  it('13. updates base message row with new ciphertext, decryptedPayload, and editedAt', async () => {
    const repos = makeMockRepos()
    repos._messagesMap.set('m_1', {
      message_id: 'm_1',
      sender_user_id: 'u_me',
      created_at: 1000,
      local_status: 'sent',
      ciphertext: new Uint8Array([1, 2, 3]),
      decrypted_payload: '{"type":"text","text":"Original"}'
    })

    await editMessage({
      deps: { ...depsBase, repos },
      messageId: 'm_1',
      newText: 'Brand new text',
      userId: 'u_me',
      now: 5000
    })

    const updated = await repos.messages.get('m_1')
    assert.equal(updated.decrypted_payload, '{"type":"text","text":"Brand new text"}')
    assert.equal(updated.edited_at, 5000)
    assert.equal(updated.updated_at, 5000)
  })

  it('14. propagates repository error from upsertVersion', async () => {
    const repos = makeMockRepos()
    repos._messagesMap.set('m_1', {
      message_id: 'm_1',
      sender_user_id: 'u_me',
      created_at: 1000,
      local_status: 'sent',
      ciphertext: new Uint8Array([1, 2, 3]),
      decrypted_payload: '{"type":"text","text":"Original"}'
    })
    repos._setThrowErrorOnUpsertVersion(true)

    await assert.rejects(async () => {
      await editMessage({
        deps: { ...depsBase, repos },
        messageId: 'm_1',
        newText: 'Failing edit',
        userId: 'u_me',
        now: 2000
      })
    }, /DB version error/)
  })
})
