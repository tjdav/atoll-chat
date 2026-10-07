import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateLocalMessageId,
  buildTextPayload,
  encodePayload,
  encodeCiphertextStub,
  isDesktopPointer,
  computeNextSeq
} from '../../src/lib/composer/index.js'

test('generateLocalMessageId returns local_ prefix string', () => {
  const fakeCrypto = {
    randomUUID: () => '12345678-1234-1234-1234-123456789abc'
  }
  const id = generateLocalMessageId(fakeCrypto)
  assert.equal(id, 'local_12345678-1234-1234-1234-123456789abc')
})

test('generateLocalMessageId falls back to getRandomValues', () => {
  const fakeCrypto = {
    getRandomValues: (arr) => {
      arr.fill(15)
      return arr
    }
  }
  const id = generateLocalMessageId(fakeCrypto)
  assert.ok(id.startsWith('local_'))
  assert.equal(id, 'local_0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f')
})

test('two calls to generateLocalMessageId return different strings', () => {
  let count = 0
  const fakeCrypto = {
    randomUUID: () => `uuid-${++count}`
  }
  const id1 = generateLocalMessageId(fakeCrypto)
  const id2 = generateLocalMessageId(fakeCrypto)
  assert.notEqual(id1, id2)
})

test('buildTextPayload empty string returns null', () => {
  assert.equal(buildTextPayload(''), null)
})

test('buildTextPayload whitespace returns null', () => {
  assert.equal(buildTextPayload('   \t\n'), null)
})

test('buildTextPayload hello returns payload', () => {
  assert.deepEqual(buildTextPayload('hello'), { type: 'text', text: 'hello' })
})

test('buildTextPayload preserves untrimmed spaces in string', () => {
  assert.deepEqual(buildTextPayload('  hello  '), { type: 'text', text: '  hello  ' })
})

test('buildTextPayload preserves internal newlines', () => {
  assert.deepEqual(buildTextPayload('line1\nline2'), { type: 'text', text: 'line1\nline2' })
})

test('buildTextPayload non-string returns null', () => {
  assert.equal(buildTextPayload(null), null)
  assert.equal(buildTextPayload(undefined), null)
  assert.equal(buildTextPayload(123), null)
})

test('encodePayload null returns empty string', () => {
  assert.equal(encodePayload(null), '')
  assert.equal(encodePayload(undefined), '')
})

test('encodePayload object returns JSON string', () => {
  const res = encodePayload({ type: 'text', text: 'hi' })
  assert.equal(res, '{"type":"text","text":"hi"}')
})

test('encodeCiphertextStub returns Uint8Array starting with stub:', () => {
  const stub = encodeCiphertextStub({ type: 'text', text: 'hi' })
  assert.ok(stub instanceof Uint8Array)
  const prefix = new TextDecoder().decode(stub.subarray(0, 5))
  assert.equal(prefix, 'stub:')
})

test('isDesktopPointer fine matchMedia returns true', () => {
  const win = {
    matchMedia: (query) => ({
      matches: query === '(pointer: fine)'
    })
  }
  assert.equal(isDesktopPointer(win), true)
})

test('isDesktopPointer coarse matchMedia returns false', () => {
  const win = {
    matchMedia: () => ({ matches: false })
  }
  assert.equal(isDesktopPointer(win), false)
})

test('isDesktopPointer null returns false', () => {
  assert.equal(isDesktopPointer(null), false)
})

test('computeNextSeq empty array returns epoch 0 seq 1', () => {
  assert.deepEqual(computeNextSeq([]), { epoch: 0, seq: 1 })
})

test('computeNextSeq bumps sequence number', () => {
  assert.deepEqual(computeNextSeq([{ epoch: 2, seq: 5 }]), { epoch: 2, seq: 6 })
})

test('computeNextSeq with epoch 0 seq 0 returns epoch 0 seq 1', () => {
  assert.deepEqual(computeNextSeq([{ epoch: 0, seq: 0 }]), { epoch: 0, seq: 1 })
})
