import assert from 'node:assert/strict'
import test from 'node:test'
import {
  truncateQuote,
  buildReplyContext,
  isReplyAllowed,
  formatReplyPreviewLabel
} from '../../src/lib/views/reply.js'

test('truncateQuote: empty and null inputs', () => {
  assert.equal(truncateQuote(''), '')
  assert.equal(truncateQuote(null), '')
  assert.equal(truncateQuote(undefined), '')
})

test('truncateQuote: short text below maxLength', () => {
  assert.equal(truncateQuote('short text'), 'short text')
})

test('truncateQuote: long text cut at word boundary', () => {
  const longText = 'The quick brown fox jumps over the lazy dog and runs across the wide green meadow'
  const truncated = truncateQuote(longText, { maxLength: 30 })
  assert.ok(truncated.length <= 31)
  assert.ok(truncated.endsWith('…'))
  assert.equal(truncated, 'The quick brown fox jumps over…')
})

test('truncateQuote: long text cut without whitespace cut at maxLength', () => {
  const longWord = 'SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious'
  const truncated = truncateQuote(longWord, { maxLength: 20 })
  assert.equal(truncated, 'Supercalifragilistic…')
})

test('buildReplyContext: missing parent returns null', async () => {
  const mockRepos = {
    messages: {
      get: async () => null
    }
  }
  const result = await buildReplyContext({
    repos: mockRepos,
    parentMessageId: 'm_missing',
    summarizePayload: () => ({ kind: 'text', text: 'hi' }),
    parsePayload: (p) => p
  })
  assert.equal(result, null)
})

test('buildReplyContext: valid text parent message', async () => {
  const mockRepos = {
    messages: {
      get: async (id) => ({
        message_id: id,
        sender_user_id: 'u_alice',
        decrypted_payload: '{"type":"text","text":"Hello world"}',
        deleted_at: null
      })
    }
  }
  const result = await buildReplyContext({
    repos: mockRepos,
    parentMessageId: 'm_1',
    summarizePayload: (p) => ({ kind: 'text', text: p.text }),
    parsePayload: (p) => JSON.parse(p)
  })
  assert.deepEqual(result, {
    messageId: 'm_1',
    senderUserId: 'u_alice',
    senderName: '',
    snippet: 'Hello world',
    isDeleted: false
  })
})

test('buildReplyContext: non-text parent message key fallback', async () => {
  const mockRepos = {
    messages: {
      get: async (id) => ({
        message_id: id,
        sender_user_id: 'u_bob',
        decrypted_payload: '{"type":"image"}',
        deleted_at: null
      })
    }
  }
  const result = await buildReplyContext({
    repos: mockRepos,
    parentMessageId: 'm_2',
    summarizePayload: () => ({ kind: 'attachment', key: 'Attachment' }),
    parsePayload: (p) => JSON.parse(p)
  })
  assert.equal(result.snippet, '[Attachment]')
})

test('buildReplyContext: tombstoned parent message sets isDeleted true', async () => {
  const mockRepos = {
    messages: {
      get: async (id) => ({
        message_id: id,
        sender_user_id: 'u_carol',
        decrypted_payload: null,
        deleted_at: 1700000000000
      })
    }
  }
  const result = await buildReplyContext({
    repos: mockRepos,
    parentMessageId: 'm_deleted',
    summarizePayload: () => ({ kind: 'tombstone' }),
    parsePayload: () => null
  })
  assert.equal(result.isDeleted, true)
})

test('isReplyAllowed: returns false for null/undefined, true for object', () => {
  assert.equal(isReplyAllowed(null), false)
  assert.equal(isReplyAllowed(undefined), false)
  assert.equal(isReplyAllowed({ message_id: 'm_1' }), true)
})

test('formatReplyPreviewLabel: formats combinations correctly', () => {
  assert.equal(formatReplyPreviewLabel({ senderName: 'Alice', snippet: 'How are you?' }), 'Alice: How are you?')
  assert.equal(formatReplyPreviewLabel({ senderName: 'Alice', snippet: '' }), 'Alice')
  assert.equal(formatReplyPreviewLabel({ senderName: '', snippet: 'How are you?' }), '')
})
