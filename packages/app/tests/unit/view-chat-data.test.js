import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  safeParsePayload,
  summarizePayload,
  groupMessages,
  insertDateSeparators,
  findNewMessagesDivider,
  formatTime,
  formatDateLabel
} from '../../src/lib/views/view-chat-data.js'

describe('View Chat Assembly Data Logic', () => {
  it('1. safeParsePayload(null) returns null', () => {
    assert.strictEqual(safeParsePayload(null), null)
  })

  it('2. safeParsePayload("") returns null', () => {
    assert.strictEqual(safeParsePayload(''), null)
  })

  it('3. safeParsePayload("not json") returns null', () => {
    assert.strictEqual(safeParsePayload('not json'), null)
  })

  it('4. safeParsePayload parses valid JSON string', () => {
    const res = safeParsePayload('{"type":"text","text":"hi"}')
    assert.deepStrictEqual(res, { type: 'text', text: 'hi' })
  })

  it('5. summarizePayload(null) returns unknown placeholder key', () => {
    assert.deepStrictEqual(summarizePayload(null), {
      kind: 'placeholder',
      key: 'chat_placeholder_unknown'
    })
  })

  it('6. summarizePayload text type returns text kind and text content', () => {
    assert.deepStrictEqual(summarizePayload({ type: 'text', text: 'hello' }), {
      kind: 'text',
      text: 'hello'
    })
  })

  it('7. summarizePayload text type missing text property defaults to empty string', () => {
    assert.deepStrictEqual(summarizePayload({ type: 'text' }), {
      kind: 'text',
      text: ''
    })
  })

  it('8. summarizePayload image type returns photo placeholder key', () => {
    assert.deepStrictEqual(summarizePayload({ type: 'image' }), {
      kind: 'placeholder',
      key: 'chat_placeholder_photo'
    })
  })

  it('9. summarizePayload video, audio, file, and sticker types return their respective placeholder keys', () => {
    assert.deepStrictEqual(summarizePayload({ type: 'video' }), {
      kind: 'placeholder',
      key: 'chat_placeholder_video'
    })
    assert.deepStrictEqual(summarizePayload({ type: 'audio' }), {
      kind: 'placeholder',
      key: 'chat_placeholder_voice'
    })
    assert.deepStrictEqual(summarizePayload({ type: 'file' }), {
      kind: 'placeholder',
      key: 'chat_placeholder_document'
    })
    assert.deepStrictEqual(summarizePayload({ type: 'sticker' }), {
      kind: 'placeholder',
      key: 'chat_placeholder_sticker'
    })
  })

  it('10. summarizePayload unknown type returns unknown placeholder key', () => {
    assert.deepStrictEqual(summarizePayload({ type: 'unknown_type' }), {
      kind: 'placeholder',
      key: 'chat_placeholder_unknown'
    })
  })

  it('11. formatTime formats UTC timestamp with hours and minutes', () => {
    const ts = Date.UTC(2026, 0, 1, 14, 32)
    const timeStr = formatTime(ts, { locale: 'en-US' })
    assert.ok(timeStr.includes('14') || timeStr.includes('2') || timeStr.includes('32'), `Expected time format, got ${timeStr}`)
  })

  it('12. formatDateLabel for same calendar day returns Today', () => {
    const now = new Date('2026-03-15T12:00:00Z').getTime()
    const msg = new Date('2026-03-15T08:30:00Z').getTime()
    assert.strictEqual(formatDateLabel(msg, now), 'Today')
  })

  it('13. formatDateLabel for previous calendar day returns Yesterday', () => {
    const now = new Date('2026-03-15T12:00:00Z').getTime()
    const msg = new Date('2026-03-14T20:00:00Z').getTime()
    assert.strictEqual(formatDateLabel(msg, now), 'Yesterday')
  })

  it('14. formatDateLabel for dates two or more days ago returns formatted date string with year', () => {
    const now = new Date('2026-03-15T12:00:00Z').getTime()
    const msg = new Date('2026-03-10T12:00:00Z').getTime()
    const label = formatDateLabel(msg, now)
    assert.ok(label.includes('2026') || label.includes('March'), `Expected date string, got ${label}`)
  })

  it('15. groupMessages([]) returns []', () => {
    assert.deepStrictEqual(groupMessages([]), [])
  })

  it('16. groupMessages with a single message returns one group', () => {
    const msgs = [{ message_id: 'm1', sender_user_id: 'u1', created_at: 1000 }]
    const groups = groupMessages(msgs)
    assert.strictEqual(groups.length, 1)
    assert.strictEqual(groups[0].senderUserId, 'u1')
    assert.strictEqual(groups[0].startIndex, 0)
    assert.strictEqual(groups[0].endIndex, 0)
    assert.deepStrictEqual(groups[0].messages, msgs)
  })

  it('17. groupMessages with two messages from same sender within window returns one group', () => {
    const msgs = [
      { message_id: 'm1', sender_user_id: 'u1', created_at: 1000 },
      { message_id: 'm2', sender_user_id: 'u1', created_at: 31000 }
    ]
    const groups = groupMessages(msgs)
    assert.strictEqual(groups.length, 1)
    assert.strictEqual(groups[0].startIndex, 0)
    assert.strictEqual(groups[0].endIndex, 1)
  })

  it('18. groupMessages with two messages from same sender exceeding window returns two groups', () => {
    const msgs = [
      { message_id: 'm1', sender_user_id: 'u1', created_at: 1000 },
      { message_id: 'm2', sender_user_id: 'u1', created_at: 1000 + 6 * 60 * 1000 }
    ]
    const groups = groupMessages(msgs)
    assert.strictEqual(groups.length, 2)
    assert.strictEqual(groups[0].endIndex, 0)
    assert.strictEqual(groups[1].startIndex, 1)
  })

  it('19. groupMessages with two messages from different senders returns two groups', () => {
    const msgs = [
      { message_id: 'm1', sender_user_id: 'u1', created_at: 1000 },
      { message_id: 'm2', sender_user_id: 'u2', created_at: 2000 }
    ]
    const groups = groupMessages(msgs)
    assert.strictEqual(groups.length, 2)
    assert.strictEqual(groups[0].senderUserId, 'u1')
    assert.strictEqual(groups[1].senderUserId, 'u2')
  })

  it('20. groupMessages with 1m gap then 10m gap returns two groups', () => {
    const msgs = [
      { message_id: 'm1', sender_user_id: 'u1', created_at: 1000 },
      { message_id: 'm2', sender_user_id: 'u1', created_at: 1000 + 60 * 1000 },
      { message_id: 'm3', sender_user_id: 'u1', created_at: 1000 + 11 * 60 * 1000 }
    ]
    const groups = groupMessages(msgs)
    assert.strictEqual(groups.length, 2)
    assert.strictEqual(groups[0].messages.length, 2)
    assert.strictEqual(groups[1].messages.length, 1)
  })

  it('21. insertDateSeparators([]) returns []', () => {
    assert.deepStrictEqual(insertDateSeparators([]), [])
  })

  it('22. insertDateSeparators with one group returns one date separator and the group', () => {
    const now = new Date('2026-03-15T12:00:00Z').getTime()
    const msgs = [{ message_id: 'm1', sender_user_id: 'u1', created_at: now }]
    const groups = groupMessages(msgs)
    const result = insertDateSeparators(groups, { now })
    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].kind, 'date')
    assert.strictEqual(result[0].label, 'Today')
    assert.strictEqual(result[1].kind, 'group')
  })

  it('23. insertDateSeparators with two groups on same day returns one date separator followed by both groups', () => {
    const now = new Date('2026-03-15T12:00:00Z').getTime()
    const t1 = new Date('2026-03-15T08:00:00Z').getTime()
    const t2 = new Date('2026-03-15T09:00:00Z').getTime()
    const msgs = [
      { message_id: 'm1', sender_user_id: 'u1', created_at: t1 },
      { message_id: 'm2', sender_user_id: 'u2', created_at: t2 }
    ]
    const groups = groupMessages(msgs)
    const result = insertDateSeparators(groups, { now })
    assert.strictEqual(result.length, 3)
    assert.strictEqual(result[0].kind, 'date')
    assert.strictEqual(result[1].kind, 'group')
    assert.strictEqual(result[2].kind, 'group')
  })

  it('24. insertDateSeparators with two groups on different days returns two date separators', () => {
    const now = new Date('2026-03-15T12:00:00Z').getTime()
    const t1 = new Date('2026-03-14T08:00:00Z').getTime()
    const t2 = new Date('2026-03-15T09:00:00Z').getTime()
    const msgs = [
      { message_id: 'm1', sender_user_id: 'u1', created_at: t1 },
      { message_id: 'm2', sender_user_id: 'u2', created_at: t2 }
    ]
    const groups = groupMessages(msgs)
    const result = insertDateSeparators(groups, { now })
    assert.strictEqual(result.length, 4)
    assert.strictEqual(result[0].kind, 'date')
    assert.strictEqual(result[0].label, 'Yesterday')
    assert.strictEqual(result[1].kind, 'group')
    assert.strictEqual(result[2].kind, 'date')
    assert.strictEqual(result[2].label, 'Today')
    assert.strictEqual(result[3].kind, 'group')
  })

  it('25. findNewMessagesDivider([], null) returns -1', () => {
    assert.strictEqual(findNewMessagesDivider([], null), -1)
  })

  it('26. findNewMessagesDivider(messages, null) returns -1', () => {
    const msgs = [{ message_id: 'm1' }, { message_id: 'm2' }]
    assert.strictEqual(findNewMessagesDivider(msgs, null), -1)
  })

  it('27. findNewMessagesDivider(messages, lastMessageId) where lastMessageId is last message returns -1', () => {
    const msgs = [{ message_id: 'm1' }, { message_id: 'm2' }]
    assert.strictEqual(findNewMessagesDivider(msgs, 'm2'), -1)
  })

  it('28. findNewMessagesDivider(messages, middleId) returns index immediately after middle message', () => {
    const msgs = [{ message_id: 'm1' }, { message_id: 'm2' }, { message_id: 'm3' }]
    assert.strictEqual(findNewMessagesDivider(msgs, 'm2'), 2)
  })

  it('29. findNewMessagesDivider(messages, unknownId) returns -1', () => {
    const msgs = [{ message_id: 'm1' }, { message_id: 'm2' }]
    assert.strictEqual(findNewMessagesDivider(msgs, 'm_unknown'), -1)
  })
})
