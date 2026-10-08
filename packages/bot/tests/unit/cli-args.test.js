import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseArgs } from '../../src/cli/args.js'

test('1. Empty argv returns empty positional and flags', () => {
  const result = parseArgs([])
  assert.deepEqual(result, { positional: [], flags: {} })
})

test('2. Only positional args', () => {
  const result = parseArgs(['foo', 'bar', 'baz'])
  assert.deepEqual(result, { positional: ['foo', 'bar', 'baz'], flags: {} })
})

test('3. Long flag with =value', () => {
  const result = parseArgs(['--out=/tmp/x'])
  assert.deepEqual(result, { positional: [], flags: { out: '/tmp/x' } })
})

test('4. Long flag with space-separated value', () => {
  const result = parseArgs(['--out', '/tmp/x'])
  assert.deepEqual(result, { positional: [], flags: { out: '/tmp/x' } })
})

test('5. Long boolean flag', () => {
  const result = parseArgs(['--verbose'])
  assert.deepEqual(result, { positional: [], flags: { verbose: true } })
})

test('6. Long boolean flag followed by another flag', () => {
  const result = parseArgs(['--verbose', '--quiet'])
  assert.deepEqual(result, { positional: [], flags: { verbose: true, quiet: true } })
})

test('7. Short boolean flag', () => {
  const result = parseArgs(['-v'])
  assert.deepEqual(result, { positional: [], flags: { v: true } })
})

test('8. Short flag does not consume the next token', () => {
  const result = parseArgs(['-v', '/tmp/x'])
  assert.deepEqual(result, { positional: ['/tmp/x'], flags: { v: true } })
})

test('9. -- terminator', () => {
  const result = parseArgs(['--', '--not-a-flag'])
  assert.deepEqual(result, { positional: ['--not-a-flag'], flags: {} })
})

test('10. - alone is positional', () => {
  const result = parseArgs(['-'])
  assert.deepEqual(result, { positional: ['-'], flags: {} })
})

test('11. Mixed positional and flags', () => {
  const result = parseArgs(['validate', './bot.js', '--strict'])
  assert.deepEqual(result, { positional: ['validate', './bot.js'], flags: { strict: true } })
})

test('12. Duplicate long flags: last wins', () => {
  const result = parseArgs(['--out=a', '--out=b'])
  assert.deepEqual(result, { positional: [], flags: { out: 'b' } })
})

test('13. Duplicate boolean flags: single true', () => {
  const result = parseArgs(['--v', '--v'])
  assert.deepEqual(result, { positional: [], flags: { v: true } })
})

test('14. Flag value beginning with - must use =', () => {
  const result = parseArgs(['--out', '-x'])
  assert.deepEqual(result, { positional: ['-x'], flags: { out: true } })
})

test('15. Value with = inside', () => {
  const result = parseArgs(['--filter=a=b'])
  assert.deepEqual(result, { positional: [], flags: { filter: 'a=b' } })
})
