import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'
import { groupItemsByRoom } from '../../../src/utils/room-grouping.js'
import { createRoomAvatar } from '../../../src/utils/room-avatar.js'

describe('Media Chat Room Grouping Utility Tests', () => {
  it('groupItemsByRoom should group items by roomId and sort room groups by newest item timestamp descending', () => {
    const items = [
      {
        id: '1',
        roomId: 'room-1',
        roomName: 'Alpha Room',
        createdAt: '2023-01-01T10:00:00.000Z',
        searchContent: 'doc1.pdf alpha room'
      },
      {
        id: '2',
        roomId: 'room-2',
        roomName: 'Beta Room',
        createdAt: '2023-01-02T12:00:00.000Z',
        searchContent: 'photo.jpg beta room'
      },
      {
        id: '3',
        roomId: 'room-1',
        roomName: 'Alpha Room',
        createdAt: '2023-01-03T15:00:00.000Z',
        searchContent: 'track.mp3 alpha room'
      }
    ]

    const grouped = groupItemsByRoom(items)

    assert.equal(grouped.length, 2)
    assert.equal(grouped[0].roomId, 'room-1')
    assert.equal(grouped[0].roomName, 'Alpha Room')
    assert.equal(grouped[0].items.length, 2)
    assert.equal(grouped[0].items[0].id, '3')
    assert.equal(grouped[0].items[1].id, '1')

    assert.equal(grouped[1].roomId, 'room-2')
    assert.equal(grouped[1].items.length, 1)
    assert.equal(grouped[1].items[0].id, '2')
  })

  it('groupItemsByRoom should handle empty or null inputs gracefully', () => {
    assert.deepEqual(groupItemsByRoom([]), [])
    assert.deepEqual(groupItemsByRoom(null), [])
    assert.deepEqual(groupItemsByRoom(undefined), [])
  })

  it('createRoomAvatar creates atoll-profile element correctly for direct and multiparty rooms', () => {
    const directRoom = {
      id: 'room-1',
      is_group: false,
      participants: [{
        id: 'user-2',
        name: 'Bob'
      }]
    }
    const avatar1 = createRoomAvatar(directRoom, {
      roomName: 'Bob',
      currentUser: { id: 'user-1' }
    })
    assert.equal(avatar1.tagName.toLowerCase(), 'atoll-profile')
    assert.equal(avatar1.getAttribute('name'), 'Bob')
    assert.equal(avatar1.getAttribute('user-id'), 'user-2')

    const groupRoom = {
      id: 'room-2',
      is_group: true,
      participants: [{
        id: 'user-2',
        name: 'Bob'
      }, {
        id: 'user-3',
        name: 'Charlie'
      }]
    }
    const avatar2 = createRoomAvatar(groupRoom, {
      roomName: 'Dev Team',
      currentUser: { id: 'user-1' }
    })
    assert.equal(avatar2.tagName.toLowerCase(), 'atoll-profile')
    assert.equal(avatar2.getAttribute('type'), 'multiparty')
    assert.equal(avatar2.getAttribute('split-count'), '2')
  })

  it('media-room-header component renders title and item count correctly', async () => {
    await loadComponent('atoll-badge')
    await loadComponent('atoll-list-item')
    await loadComponent('atoll-profile')
    await loadComponent('media-room-header')

    const el = document.createElement('media-room-header')
    el.setAttribute('room-id', 'room-100')
    el.setAttribute('room-name', 'General Room')
    el.setAttribute('item-count', '5')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const listItem = el.querySelector('[ref$="itemRoot"]') || el.querySelector('atoll-list-item')
    assert.ok(listItem)
    assert.equal(listItem.getAttribute('title'), 'General Room')
    assert.equal(listItem.getAttribute('badge'), '5')
  })
})
