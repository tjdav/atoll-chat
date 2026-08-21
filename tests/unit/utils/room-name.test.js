import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRoomName } from '../../../src/utils/room-name.js'

describe('resolveRoomName Utility', () => {
  test('returns fallback ("Unknown Chat") when room is null or undefined', () => {
    assert.equal(resolveRoomName(null), 'Unknown Chat')
    assert.equal(resolveRoomName(undefined), 'Unknown Chat')
    assert.equal(resolveRoomName(null, { fallback: 'Custom Fallback' }), 'Custom Fallback')
  })

  test('prioritizes explicit custom room name', () => {
    const room = {
      id: 'room-1',
      name: 'Project Alpha',
      is_group: true,
      participants: [{
        id: 'user-1',
        name: 'Alice'
      }, {
        id: 'user-2',
        name: 'Bob'
      }]
    }
    assert.equal(resolveRoomName(room, { currentUser: 'user-1' }), 'Project Alpha')
  })

  test('ignores whitespace-only room name and resolves via priority rules', () => {
    const room = {
      id: 'room-1',
      name: '   ',
      is_group: false,
      participants: [{
        id: 'user-1',
        name: 'Alice'
      }, {
        id: 'user-2',
        name: 'Bob'
      }]
    }
    assert.equal(resolveRoomName(room, { currentUser: 'user-1' }), 'Bob')
  })

  describe('1:1 Direct Messages', () => {
    test('resolves to other participant display name / nickname', () => {
      const room = {
        id: 'room-dm-1',
        is_group: false,
        participants: [
          {
            id: 'user-1',
            name: 'Alice'
          },
          {
            id: 'user-2',
            name: 'Bob',
            username: 'bob_user'
          }
        ]
      }
      assert.equal(resolveRoomName(room, { currentUser: 'user-1' }), 'Bob')
    })

    test('prioritizes local nickname over user name and username', () => {
      const room = {
        id: 'room-dm-1',
        is_group: false,
        participants: [
          {
            id: 'user-1',
            name: 'Alice'
          },
          {
            id: 'user-2',
            name: 'Bob',
            username: 'bob_user'
          }
        ]
      }
      const nicknames = { 'user-2': 'Bobby' }
      assert.equal(resolveRoomName(room, {
        currentUser: 'user-1',
        nicknames
      }), 'Bobby')
    })

    test('falls back to username when name is missing', () => {
      const room = {
        id: 'room-dm-1',
        is_group: false,
        participants: [
          {
            id: 'user-1',
            name: 'Alice'
          },
          {
            id: 'user-2',
            username: 'bobby99'
          }
        ]
      }
      assert.equal(resolveRoomName(room, { currentUser: 'user-1' }), 'bobby99')
    })

    test('falls back to "Chat" when 1:1 participant info is empty', () => {
      const room = {
        id: 'room-dm-empty',
        is_group: false,
        participants: []
      }
      assert.equal(resolveRoomName(room, { currentUser: 'user-1' }), 'Chat')
    })
  })

  describe('Unnamed Group Chats', () => {
    test('formats up to 3 participant names', () => {
      const room = {
        id: 'group-1',
        is_group: true,
        participants: [
          {
            id: 'user-1',
            name: 'Self'
          },
          {
            id: 'user-2',
            name: 'Alice'
          },
          {
            id: 'user-3',
            name: 'Bob'
          },
          {
            id: 'user-4',
            name: 'Charlie'
          }
        ]
      }
      assert.equal(resolveRoomName(room, { currentUser: 'user-1' }), 'Alice, Bob, Charlie')
    })

    test('formats >3 participant names with +N remaining suffix', () => {
      const room = {
        id: 'group-2',
        is_group: true,
        participants: [
          {
            id: 'user-1',
            name: 'Self'
          },
          {
            id: 'user-2',
            name: 'Alice'
          },
          {
            id: 'user-3',
            name: 'Bob'
          },
          {
            id: 'user-4',
            name: 'Charlie'
          },
          {
            id: 'user-5',
            name: 'David'
          },
          {
            id: 'user-6',
            name: 'Eve'
          }
        ]
      }
      assert.equal(resolveRoomName(room, { currentUser: 'user-1' }), 'Alice, Bob, Charlie +2')
    })

    test('falls back to "Group" when unnamed group has no participant names', () => {
      const room = {
        id: 'group-empty',
        is_group: true,
        participants: [{ id: 'user-1' }]
      }
      assert.equal(resolveRoomName(room, { currentUser: 'user-1' }), 'Group')
    })
  })
})
