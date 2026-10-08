import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_EMOJI, isReactionAllowed, toggleReaction } from '../../src/lib/views/reactions.js'

describe('Reactions View Logic', () => {
  it('1. DEFAULT_EMOJI is a frozen array of six strings', () => {
    assert.ok(Array.isArray(DEFAULT_EMOJI))
    assert.strictEqual(DEFAULT_EMOJI.length, 6)
    assert.ok(Object.isFrozen(DEFAULT_EMOJI))
    assert.deepEqual([...DEFAULT_EMOJI], ['👍', '❤️', '😂', '😮', '😢', '🎉'])
  })

  it('2. isReactionAllowed(null) returns false', () => {
    assert.strictEqual(isReactionAllowed(null), false)
    assert.strictEqual(isReactionAllowed(undefined), false)
  })

  it('3. isReactionAllowed({ deleted_at: 1234 }) returns false', () => {
    assert.strictEqual(isReactionAllowed({ deleted_at: 1234 }), false)
  })

  it('4. isReactionAllowed({ deleted_at: null }) returns true', () => {
    assert.strictEqual(isReactionAllowed({ deleted_at: null }), true)
  })

  it('5. toggleReaction when user has reacted removes reaction and returns { reacted: false }', async () => {
    let removeCalled = false
    let addCalled = false
    let removeArgs = null

    const mockRepos = {
      reactions: {
        async hasReacted(messageId, userId, reaction) {
          return messageId === 'm_1' && userId === 'u_1' && reaction === '👍'
        },
        async listForMessage(messageId) {
          if (messageId === 'm_1') {
            return [
              {
                message_id: 'm_1',
                sender_user_id: 'u_1',
                sender_client_id: 'c_1',
                reaction: '👍',
                deleted_at: null
              }
            ]
          }
          return []
        },
        async remove(args) {
          removeCalled = true
          removeArgs = args
        },
        async add() {
          addCalled = true
        }
      }
    }

    const result = await toggleReaction({
      repos: mockRepos,
      messageId: 'm_1',
      userId: 'u_1',
      clientId: 'c_1',
      reaction: '👍'
    })

    assert.deepEqual(result, { reacted: false })
    assert.strictEqual(removeCalled, true)
    assert.strictEqual(addCalled, false)
    assert.deepEqual(removeArgs, {
      messageId: 'm_1',
      senderUserId: 'u_1',
      senderClientId: 'c_1',
      reaction: '👍'
    })
  })

  it('6. toggleReaction when user has not reacted adds reaction and returns { reacted: true }', async () => {
    let removeCalled = false
    let addCalled = false
    let addArgs = null

    const mockRepos = {
      reactions: {
        async hasReacted() {
          return false
        },
        async add(args) {
          addCalled = true
          addArgs = args
        },
        async remove() {
          removeCalled = true
        }
      }
    }

    const result = await toggleReaction({
      repos: mockRepos,
      messageId: 'm_1',
      userId: 'u_1',
      clientId: 'c_1',
      reaction: '❤️'
    })

    assert.deepEqual(result, { reacted: true })
    assert.strictEqual(addCalled, true)
    assert.strictEqual(removeCalled, false)
    assert.strictEqual(addArgs.messageId, 'm_1')
    assert.strictEqual(addArgs.senderUserId, 'u_1')
    assert.strictEqual(addArgs.senderClientId, 'c_1')
    assert.strictEqual(addArgs.reaction, '❤️')
    assert.ok(typeof addArgs.createdAt === 'number')
  })

  it('7. toggleReaction when hasReacted is true but no active row exists handles race condition gracefully', async () => {
    let removeCalled = false
    let addCalled = false

    const mockRepos = {
      reactions: {
        async hasReacted() {
          return true
        },
        async listForMessage() {
          return []
        },
        async remove() {
          removeCalled = true
        },
        async add() {
          addCalled = true
        }
      }
    }

    const result = await toggleReaction({
      repos: mockRepos,
      messageId: 'm_1',
      userId: 'u_1',
      clientId: 'c_1',
      reaction: '👍'
    })

    assert.deepEqual(result, { reacted: false })
    assert.strictEqual(removeCalled, false)
    assert.strictEqual(addCalled, false)
  })

  it('8. toggleReaction propagates repository errors', async () => {
    const mockRepos = {
      reactions: {
        async hasReacted() {
          throw new Error('Database error')
        }
      }
    }

    await assert.rejects(
      async () => {
        await toggleReaction({
          repos: mockRepos,
          messageId: 'm_1',
          userId: 'u_1',
          clientId: 'c_1',
          reaction: '👍'
        })
      },
      { message: 'Database error' }
    )
  })
})
