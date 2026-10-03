import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptDisplayName, decryptDisplayName } from '../../src/lib/crypto/display-name.js';
import { deriveDisplayNameKey } from '../../src/lib/oprf/index.js';

test('encryptDisplayName and decryptDisplayName round-trip ASCII string', async () => {
  const token = new Uint8Array(64).fill(0x01);
  const key = await deriveDisplayNameKey(token);

  const original = 'Alice';
  const encrypted = await encryptDisplayName(original, key);
  const decrypted = await decryptDisplayName(encrypted, key);

  assert.equal(decrypted, original);
});

test('encryptDisplayName and decryptDisplayName round-trip multi-byte UTF-8 string', async () => {
  const token = new Uint8Array(64).fill(0x02);
  const key = await deriveDisplayNameKey(token);

  const original = 'Alice 🌺 日本語 🚀';
  const encrypted = await encryptDisplayName(original, key);
  const decrypted = await decryptDisplayName(encrypted, key);

  assert.equal(decrypted, original);
});

test('encryptDisplayName and decryptDisplayName round-trip empty string', async () => {
  const token = new Uint8Array(64).fill(0x03);
  const key = await deriveDisplayNameKey(token);

  const original = '';
  const encrypted = await encryptDisplayName(original, key);
  const decrypted = await decryptDisplayName(encrypted, key);

  assert.equal(decrypted, original);
});

test('encryptDisplayName generates unique nonces for identical plaintexts', async () => {
  const token = new Uint8Array(64).fill(0x04);
  const key = await deriveDisplayNameKey(token);

  const plaintext = 'Bob';
  const enc1 = await encryptDisplayName(plaintext, key);
  const enc2 = await encryptDisplayName(plaintext, key);

  assert.notDeepEqual(enc1, enc2);
});

test('length invariant: output length equals 12 + plaintext_utf8_bytes + 16', async () => {
  const token = new Uint8Array(64).fill(0x05);
  const key = await deriveDisplayNameKey(token);

  const plaintext = 'Alice'; // 5 UTF-8 bytes
  const encrypted = await encryptDisplayName(plaintext, key);

  assert.equal(encrypted.length, 12 + 5 + 16);
});

test('length bound: 256 UTF-8 bytes succeeds, 257 UTF-8 bytes throws', async () => {
  const token = new Uint8Array(64).fill(0x06);
  const key = await deriveDisplayNameKey(token);

  const valid256 = 'a'.repeat(256);
  const encrypted = await encryptDisplayName(valid256, key);
  const decrypted = await decryptDisplayName(encrypted, key);
  assert.equal(decrypted, valid256);

  const invalid257 = 'a'.repeat(257);
  await assert.rejects(
    async () => encryptDisplayName(invalid257, key),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'Display name exceeds 256 bytes.');
      return true;
    }
  );
});

test('tampering with encrypted bytes causes decryption to throw', async () => {
  const token = new Uint8Array(64).fill(0x07);
  const key = await deriveDisplayNameKey(token);

  const encrypted = await encryptDisplayName('Charlie', key);
  encrypted[15] ^= 0xff; // flip a byte in ciphertext

  await assert.rejects(async () => decryptDisplayName(encrypted, key));
});

test('decrypting with wrong key throws', async () => {
  const token1 = new Uint8Array(64).fill(0x08);
  const token2 = new Uint8Array(64).fill(0x09);
  const key1 = await deriveDisplayNameKey(token1);
  const key2 = await deriveDisplayNameKey(token2);

  const encrypted = await encryptDisplayName('David', key1);

  await assert.rejects(async () => decryptDisplayName(encrypted, key2));
});
