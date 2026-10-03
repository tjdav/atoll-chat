import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  base64ToBase64url,
  base64urlToBase64,
  bytesToBase64url,
  base64urlToBytes,
} from '../../src/lib/codec/index.js';

test('base64ToBase64url converts plus, slash, and strips equals padding', () => {
  assert.equal(base64ToBase64url('a+b/c=='), 'a-b_c');
  assert.equal(base64ToBase64url('ABC+DEF/GHI='), 'ABC-DEF_GHI');
});

test('base64urlToBase64 converts dash and underscore', () => {
  assert.equal(base64urlToBase64('a-b_c'), 'a+b/c');
  assert.equal(base64urlToBase64('ABC-DEF_GHI'), 'ABC+DEF/GHI');
});

test('bytesToBase64url and base64urlToBytes round-trips random 64-byte array', () => {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (i * 37 + 13) % 256;
  }

  const encoded = bytesToBase64url(bytes);
  assert.equal(typeof encoded, 'string');
  assert.equal(encoded.includes('+'), false);
  assert.equal(encoded.includes('/'), false);
  assert.equal(encoded.includes('='), false);

  const decoded = base64urlToBytes(encoded);
  assert.deepEqual(decoded, bytes);
});

test('empty byte array and empty string round-trips cleanly', () => {
  const emptyBytes = new Uint8Array(0);
  assert.equal(bytesToBase64url(emptyBytes), '');

  const decodedEmpty = base64urlToBytes('');
  assert.equal(decodedEmpty instanceof Uint8Array, true);
  assert.equal(decodedEmpty.length, 0);
});
