import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { groupItemsByRoom } from '../../../src/utils/room-grouping.js'

describe('groupItemsByRoom Utility', () => {
  test('returns an empty array when items is null, undefined, or empty', () => {
    assert.deepEqual(groupItemsByRoom(null), [])
    assert.deepEqual(groupItemsByRoom(undefined), [])
    assert.deepEqual(groupItemsByRoom([]), [])
  })

  describe('Room ID Extraction and Fallbacks', () => {
    test('uses entry.roomId when provided', () => {
      const items = [
        { id: '1', roomId: 'room-a', createdAt: '2025-01-01T10:00:00Z' }
      ]
      const result = groupItemsByRoom(items)
      assert.equal(result.length, 1)
      assert.equal(result[0].roomId, 'room-a')
    })

    test('falls back to entry.item.room_id when entry.roomId is missing', () => {
      const items = [
        { id: '1', item: { room_id: 'room-b', created_at: '2025-01-01T10:00:00Z' } }
      ]
      const result = groupItemsByRoom(items)
      assert.equal(result.length, 1)
      assert.equal(result[0].roomId, 'room-b')
    })

    test('falls back to "unknown" when both entry.roomId and entry.item.room_id are missing', () => {
      const items = [
        { id: '1', createdAt: '2025-01-01T10:00:00Z' }
      ]
      const result = groupItemsByRoom(items)
      assert.equal(result.length, 1)
      assert.equal(result[0].roomId, 'unknown')
    })
  })

  describe('Group Metadata Fallbacks', () => {
    test('uses room and roomName from entry or applies default fallbacks', () => {
      const mockRoom = { id: 'room-1', name: 'General' }
      const items = [
        { id: '1', roomId: 'room-1', room: mockRoom, roomName: 'General Chat' }
      ]
      const result = groupItemsByRoom(items)
      assert.equal(result[0].room, mockRoom)
      assert.equal(result[0].roomName, 'General Chat')

      const itemsFallback = [
        { id: '2', roomId: 'room-2' }
      ]
      const resultFallback = groupItemsByRoom(itemsFallback)
      assert.equal(resultFallback[0].room, null)
      assert.equal(resultFallback[0].roomName, 'Unknown Chat')
    })
  })

  describe('Item Timestamp Resolution & Sorting Within Room Groups', () => {
    test('resolves timestamps from createdAt or entry.item.created_at and defaults to 0 if missing', () => {
      const items = [
        { id: 'msg-old', roomId: 'room-1', item: { created_at: '2025-01-01T08:00:00Z' } },
        { id: 'msg-new', roomId: 'room-1', createdAt: '2025-01-01T12:00:00Z' },
        { id: 'msg-none', roomId: 'room-1' } // missing timestamp -> 0 (1970)
      ]
      const result = groupItemsByRoom(items)
      assert.equal(result.length, 1)

      const groupItems = result[0].items
      assert.equal(groupItems.length, 3)
      assert.equal(groupItems[0].id, 'msg-new')
      assert.equal(groupItems[1].id, 'msg-old')
      assert.equal(groupItems[2].id, 'msg-none')
    })

    test('sorts items within a room group newest to oldest', () => {
      const items = [
        { id: 'item-1', roomId: 'room-1', createdAt: '2025-01-01T10:00:00.000Z' },
        { id: 'item-3', roomId: 'room-1', createdAt: '2025-01-01T12:00:00.000Z' },
        { id: 'item-2', roomId: 'room-1', createdAt: '2025-01-01T11:00:00.000Z' }
      ]
      const result = groupItemsByRoom(items)
      assert.equal(result[0].items[0].id, 'item-3')
      assert.equal(result[0].items[1].id, 'item-2')
      assert.equal(result[0].items[2].id, 'item-1')
    })
  })

  describe('Sorting Across Room Groups', () => {
    test('sorts room groups by newest item timestamp descending (latestTimestamp)', () => {
      const items = [
        { id: 'room1-msg1', roomId: 'room-1', createdAt: '2025-01-01T10:00:00Z' },
        { id: 'room2-msg1', roomId: 'room-2', createdAt: '2025-01-01T09:00:00Z' },
        { id: 'room2-msg2', roomId: 'room-2', createdAt: '2025-01-01T14:00:00Z' }, // newest item in entire dataset
        { id: 'room3-msg1', roomId: 'room-3', createdAt: '2025-01-01T11:00:00Z' }
      ]
      const result = groupItemsByRoom(items)
      assert.equal(result.length, 3)

      // Expected order:
      // 1. room-2 (latestTimestamp: 14:00)
      // 2. room-3 (latestTimestamp: 11:00)
      // 3. room-1 (latestTimestamp: 10:00)
      assert.equal(result[0].roomId, 'room-2')
      assert.equal(result[1].roomId, 'room-3')
      assert.equal(result[2].roomId, 'room-1')

      // Check latestTimestamp property values
      assert.equal(result[0].latestTimestamp, new Date('2025-01-01T14:00:00Z').getTime())
      assert.equal(result[1].latestTimestamp, new Date('2025-01-01T11:00:00Z').getTime())
      assert.equal(result[2].latestTimestamp, new Date('2025-01-01T10:00:00Z').getTime())
    })
  })
})
