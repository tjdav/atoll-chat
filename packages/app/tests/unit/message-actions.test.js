import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  copyMessage,
  deleteForMe,
  unsend,
  isUnsendAvailable
} from '../../src/lib/views/message-actions.js'

describe('Message Actions Orchestration', () => {
  it('1. copyMessage on a text message calls clipboard.writeText with the text and returns copied: true', async () => {
    let written = null
    const deps = {
      repos: {
        messages: {
          get: async (id) => ({
            message_id: id,
            decrypted_payload: JSON.stringify({ type: 'text', text: 'Hello world' })
          })
        }
      },
      clipboard: {
        writeText: async (str) => { written = str }
      },
      parsePayload: (raw) => JSON.parse(raw),
      summarizePayload: (payload) => ({ kind: 'text', text: payload.text })
    }

    const res = await copyMessage({ deps, messageId: 'm_1' })
    assert.deepEqual(res, { copied: true })
    assert.equal(written, 'Hello world')
  })

  it('2. copyMessage on a non-text message returns copied: false, reason: "not-text"', async () => {
    let written = null
    const deps = {
      repos: {
        messages: {
          get: async (id) => ({
            message_id: id,
            decrypted_payload: JSON.stringify({ type: 'image', fileId: 'f_1' })
          })
        }
      },
      clipboard: {
        writeText: async (str) => { written = str }
      },
      parsePayload: (raw) => JSON.parse(raw),
      summarizePayload: () => ({ kind: 'image' })
    }

    const res = await copyMessage({ deps, messageId: 'm_1' })
    assert.deepEqual(res, { copied: false, reason: 'not-text' })
    assert.equal(written, null)
  })

  it('3. copyMessage on an unknown id returns copied: false, reason: "not-found"', async () => {
    const deps = {
      repos: {
        messages: {
          get: async () => null
        }
      },
      clipboard: {
        writeText: async () => {}
      },
      parsePayload: (raw) => JSON.parse(raw),
      summarizePayload: () => ({ kind: 'text', text: '' })
    }

    const res = await copyMessage({ deps, messageId: 'm_missing' })
    assert.deepEqual(res, { copied: false, reason: 'not-found' })
  })

  it('4. deleteForMe calls messages.remove and returns removed: true on changes > 0', async () => {
    let removedId = null
    const deps = {
      repos: {
        messages: {
          remove: async (id) => {
            removedId = id
            return { changes: 1 }
          }
        }
      }
    }

    const res = await deleteForMe({ deps, messageId: 'm_1' })
    assert.deepEqual(res, { removed: true })
    assert.equal(removedId, 'm_1')
  })

  it('5. deleteForMe returns removed: false on changes === 0', async () => {
    const deps = {
      repos: {
        messages: {
          remove: async () => ({ changes: 0 })
        }
      }
    }

    const res = await deleteForMe({ deps, messageId: 'm_1' })
    assert.deepEqual(res, { removed: false })
  })

  it('6. unsend from sender within window on sent message calls messages.markDeleted and returns unsent: true', async () => {
    let markedId = null
    const deps = {
      repos: {
        messages: {
          get: async (id) => ({
            message_id: id,
            sender_user_id: 'u_alice',
            local_status: 'sent',
            created_at: Date.now() - 1000
          }),
          markDeleted: async (id) => {
            markedId = id
            return { changes: 1 }
          }
        }
      }
    }

    const res = await unsend({ deps, messageId: 'm_1', userId: 'u_alice' })
    assert.deepEqual(res, { unsent: true })
    assert.equal(markedId, 'm_1')
  })

  it('7. unsend from a different user returns unsent: false, reason: "not-sender"', async () => {
    let marked = false
    const deps = {
      repos: {
        messages: {
          get: async (id) => ({
            message_id: id,
            sender_user_id: 'u_alice',
            local_status: 'sent',
            created_at: Date.now() - 1000
          }),
          markDeleted: async () => { marked = true; return { changes: 1 } }
        }
      }
    }

    const res = await unsend({ deps, messageId: 'm_1', userId: 'u_bob' })
    assert.deepEqual(res, { unsent: false, reason: 'not-sender' })
    assert.equal(marked, false)
  })

  it('8. unsend on a pending message returns unsent: false, reason: "not-sent"', async () => {
    const deps = {
      repos: {
        messages: {
          get: async (id) => ({
            message_id: id,
            sender_user_id: 'u_alice',
            local_status: 'pending',
            created_at: Date.now() - 1000
          })
        }
      }
    }

    const res = await unsend({ deps, messageId: 'm_1', userId: 'u_alice' })
    assert.deepEqual(res, { unsent: false, reason: 'not-sent' })
  })

  it('9. unsend on a message older than 24 hours returns unsent: false, reason: "window-expired"', async () => {
    const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000)
    const deps = {
      repos: {
        messages: {
          get: async (id) => ({
            message_id: id,
            sender_user_id: 'u_alice',
            local_status: 'sent',
            created_at: oldTimestamp
          })
        }
      }
    }

    const res = await unsend({ deps, messageId: 'm_1', userId: 'u_alice' })
    assert.deepEqual(res, { unsent: false, reason: 'window-expired' })
  })

  it('10. unsend on an unknown id returns unsent: false, reason: "not-found"', async () => {
    const deps = {
      repos: {
        messages: {
          get: async () => null
        }
      }
    }

    const res = await unsend({ deps, messageId: 'm_missing', userId: 'u_alice' })
    assert.deepEqual(res, { unsent: false, reason: 'not-found' })
  })

  it('11. isUnsendAvailable(null, "u") returns false', () => {
    assert.equal(isUnsendAvailable(null, 'u_alice'), false)
  })

  it('12. isUnsendAvailable for a non-sender returns false', () => {
    const msg = { sender_user_id: 'u_alice', local_status: 'sent', created_at: Date.now() }
    assert.equal(isUnsendAvailable(msg, 'u_bob'), false)
  })

  it('13. isUnsendAvailable for a pending message from sender returns false', () => {
    const msg = { sender_user_id: 'u_alice', local_status: 'pending', created_at: Date.now() }
    assert.equal(isUnsendAvailable(msg, 'u_alice'), false)
  })

  it('14. isUnsendAvailable for a message older than 24 hours returns false', () => {
    const oldTime = Date.now() - (25 * 60 * 60 * 1000)
    const msg = { sender_user_id: 'u_alice', local_status: 'sent', created_at: oldTime }
    assert.equal(isUnsendAvailable(msg, 'u_alice'), false)
  })

  it('15. isUnsendAvailable for a sent message from sender within 24 hours returns true', () => {
    const recentTime = Date.now() - (5 * 60 * 1000)
    const msg = { sender_user_id: 'u_alice', local_status: 'sent', created_at: recentTime }
    assert.equal(isUnsendAvailable(msg, 'u_alice'), true)
  })
})
