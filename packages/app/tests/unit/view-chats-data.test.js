import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatRelativeTime,
  resolveRoomName,
  resolvePreview,
  computeUnread,
  assembleRooms
} from '../../src/lib/views/view-chats-data.js'

const mockTranslations = {
  chats_preview_no_messages: 'No messages yet',
  chats_preview_you_prefix: 'You',
  chats_preview_photo: 'Photo',
  chats_preview_video: 'Video',
  chats_preview_voice: 'Voice message',
  chats_preview_document: 'Document',
  chats_preview_sticker: 'Sticker'
}

test('1. formatRelativeTime: returns "now" for deltas under 1 minute', () => {
  const now = 1_000_000_000
  assert.equal(formatRelativeTime(now - 30_000, now), 'now')
})

test('2. formatRelativeTime: returns minutes ("5m") for deltas under 1 hour', () => {
  const now = 1_000_000_000
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5m')
})

test('3. formatRelativeTime: returns hours ("3h") for deltas under 1 day', () => {
  const now = 1_000_000_000
  assert.equal(formatRelativeTime(now - 3 * 60 * 60_000, now), '3h')
})

test('4. formatRelativeTime: returns days ("2d") for deltas over 1 day', () => {
  const now = 1_000_000_000
  assert.equal(formatRelativeTime(now - 2 * 24 * 60 * 60_000, now), '2d')
})

test('5. resolveRoomName: uses explicit room name when present', () => {
  const room = { room_id: 'r_1', name: 'General Chat' }
  assert.equal(resolveRoomName(room, ['Alice', 'Bob'], mockTranslations), 'General Chat')
})

test('6. resolveRoomName: uses single member name for 1:1 chats', () => {
  const room = { room_id: 'r_1' }
  assert.equal(resolveRoomName(room, ['Alice'], mockTranslations), 'Alice')
})

test('7. resolveRoomName: joins two member names with comma', () => {
  const room = { room_id: 'r_1' }
  assert.equal(resolveRoomName(room, ['Alice', 'Bob'], mockTranslations), 'Alice, Bob')
})

test('8. resolveRoomName: joins first two member names with +N count for larger groups', () => {
  const room = { room_id: 'r_1' }
  assert.equal(resolveRoomName(room, ['Alice', 'Bob', 'Charlie', 'Dave'], mockTranslations), 'Alice, Bob + 2')
})

test('9. resolveRoomName: returns fallback string when display names are empty and room has no name', () => {
  const room = { room_id: 'r_1' }
  assert.equal(resolveRoomName(room, [], mockTranslations), 'No messages yet')
})

test('10. resolvePreview: formats text preview sent by current user with "You:" prefix', () => {
  const msg = {
    sender_user_id: 'u_me',
    decrypted_payload: JSON.stringify({ type: 'text', text: 'Hello world' })
  }
  assert.equal(resolvePreview(msg, ['Alice'], 'u_me', mockTranslations), 'You: Hello world')
})

test('11. resolvePreview: formats text preview sent by another user with sender name prefix', () => {
  const msg = {
    sender_user_id: 'u_alice',
    decrypted_payload: JSON.stringify({ type: 'text', text: 'Hi there' })
  }
  assert.equal(resolvePreview(msg, ['Alice'], 'u_me', mockTranslations), 'Alice: Hi there')
})

test('12. resolvePreview: formats image payload with localized Photo label', () => {
  const msg = {
    sender_user_id: 'u_alice',
    decrypted_payload: JSON.stringify({ type: 'image' })
  }
  assert.equal(resolvePreview(msg, ['Alice'], 'u_me', mockTranslations), 'Alice: Photo')
})

test('13. resolvePreview: returns localized fallback when lastMessage is null', () => {
  assert.equal(resolvePreview(null, ['Alice'], 'u_me', mockTranslations), 'No messages yet')
})

test('14. resolvePreview: returns localized fallback when decrypted_payload is invalid JSON', () => {
  const msg = {
    sender_user_id: 'u_alice',
    decrypted_payload: 'invalid-json'
  }
  assert.equal(resolvePreview(msg, ['Alice'], 'u_me', mockTranslations), 'No messages yet')
})

test('15. computeUnread: returns true when readState is null/missing', () => {
  const msg = { message_id: 'm_1' }
  assert.equal(computeUnread(null, msg), true)
})

test('16. computeUnread: returns false when last_read_message_id matches newest message_id', () => {
  const readState = { last_read_message_id: 'm_1' }
  const msg = { message_id: 'm_1' }
  assert.equal(computeUnread(readState, msg), false)
})

test('17. computeUnread: returns true when last_read_message_id differs from newest message_id', () => {
  const readState = { last_read_message_id: 'm_1' }
  const msg = { message_id: 'm_2' }
  assert.equal(computeUnread(readState, msg), true)
})

test('18. computeUnread: returns false when lastMessage is null', () => {
  const readState = { last_read_message_id: 'm_1' }
  assert.equal(computeUnread(readState, null), false)
})

test('19. assembleRooms: orders rooms strictly according to orderRows index', () => {
  const rooms = [
    { room_id: 'r_1', updated_at: 100 },
    { room_id: 'r_2', updated_at: 200 }
  ]
  const orderRows = ['r_2', 'r_1']
  const result = assembleRooms({
    rooms,
    orderRows,
    currentUserId: 'u_me',
    translations: mockTranslations
  })
  assert.equal(result[0].roomId, 'r_2')
  assert.equal(result[1].roomId, 'r_1')
})

test('20. assembleRooms: appends rooms missing from orderRows ordered by updated_at DESC', () => {
  const rooms = [
    { room_id: 'r_1', updated_at: 100 },
    { room_id: 'r_2', updated_at: 300 },
    { room_id: 'r_3', updated_at: 200 }
  ]
  const orderRows = ['r_1']
  const result = assembleRooms({
    rooms,
    orderRows,
    currentUserId: 'u_me',
    translations: mockTranslations
  })
  assert.equal(result[0].roomId, 'r_1')
  assert.equal(result[1].roomId, 'r_2')
  assert.equal(result[2].roomId, 'r_3')
})

test('21. assembleRooms: sets hasDraft: true and preview to draft text when room draft exists', () => {
  const rooms = [{ room_id: 'r_1', updated_at: 100 }]
  const drafts = [{ room_id: 'r_1', text: 'Unsent draft text' }]
  const lastMessagesByRoom = {
    r_1: {
      message_id: 'm_1',
      sender_user_id: 'u_alice',
      decrypted_payload: JSON.stringify({ type: 'text', text: 'Sent message' })
    }
  }
  const result = assembleRooms({
    rooms,
    drafts,
    lastMessagesByRoom,
    displayNamesByRoom: { r_1: ['Alice'] },
    currentUserId: 'u_me',
    translations: mockTranslations
  })
  assert.equal(result[0].hasDraft, true)
  assert.equal(result[0].preview, 'Unsent draft text')
})

test('22. assembleRooms: identifies groups (isGroup: true) when member count exceeds 2', () => {
  const rooms = [{ room_id: 'r_1', updated_at: 100 }]
  const result = assembleRooms({
    rooms,
    displayNamesByRoom: { r_1: ['Alice', 'Bob'] },
    currentUserId: 'u_me',
    translations: mockTranslations
  })
  assert.equal(result[0].isGroup, true)
})
