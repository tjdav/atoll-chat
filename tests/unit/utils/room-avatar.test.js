import { describe, it } from 'node:test'
import assert from 'node:assert'
import { getParsedAvatar, createRoomAvatar } from '../../../src/utils/room-avatar.js'

describe('room-avatar utility unit tests', () => {
  it('getParsedAvatar returns null for null, undefined, or missing avatar', () => {
    assert.strictEqual(getParsedAvatar(null), null)
    assert.strictEqual(getParsedAvatar(undefined), null)
    assert.strictEqual(getParsedAvatar({}), null)
    assert.strictEqual(getParsedAvatar({ avatar: null }), null)
    assert.strictEqual(getParsedAvatar({ avatar: '' }), null)
  })

  it('getParsedAvatar returns non-string avatar objects directly', () => {
    const avatarObj = { media_id: 'media_123', key: 'abc', nonce: 'xyz' }
    const room = { avatar: avatarObj }
    assert.strictEqual(getParsedAvatar(room), avatarObj)
  })

  it('getParsedAvatar parses valid JSON avatar strings and caches the result', () => {
    const avatarObj = { media_id: 'media_456', key: 'key123', nonce: 'nonce123' }
    const room = { avatar: JSON.stringify(avatarObj) }

    const result1 = getParsedAvatar(room)
    assert.deepStrictEqual(result1, avatarObj)

    // Second call should return exact same reference from WeakMap cache
    const result2 = getParsedAvatar(room)
    assert.strictEqual(result1, result2)
  })

  it('getParsedAvatar re-parses when room.avatar string changes', () => {
    const avatar1 = { media_id: 'media_1' }
    const avatar2 = { media_id: 'media_2' }
    const room = { avatar: JSON.stringify(avatar1) }

    const res1 = getParsedAvatar(room)
    assert.deepStrictEqual(res1, avatar1)

    // Update avatar string on same room object
    room.avatar = JSON.stringify(avatar2)
    const res2 = getParsedAvatar(room)
    assert.deepStrictEqual(res2, avatar2)
    assert.notStrictEqual(res1, res2)
  })

  it('getParsedAvatar handles invalid JSON gracefully and returns null', () => {
    const room = { avatar: 'invalid-json-{missing-quotes}' }
    assert.strictEqual(getParsedAvatar(room), null)
  })

  it('createRoomAvatar configures atoll-profile element correctly using cached avatar', async () => {
    const avatarData = { media_id: 'media_test', key: 'k', nonce: 'n' }
    const room = {
      id: 'room_1',
      name: 'Test Room',
      avatar: JSON.stringify(avatarData)
    }

    let decryptCalledWith = null
    const $media = {
      decrypt: async (payload, options) => {
        decryptCalledWith = { payload, options }
        return 'blob:http://localhost/test-avatar-url'
      }
    }

    const profile = createRoomAvatar(room, { $media })
    assert.strictEqual(profile.tagName.toLowerCase(), 'atoll-profile')
    assert.strictEqual(profile.getAttribute('name'), 'Test Room')
    assert.strictEqual(profile.getAttribute('alt'), 'Test Room')

    // Wait for microtask/promise resolution from $media.decrypt
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.ok(decryptCalledWith)
    assert.deepStrictEqual(decryptCalledWith.payload, avatarData)
    assert.strictEqual(profile.getAttribute('src'), 'blob:http://localhost/test-avatar-url')
  })
})
