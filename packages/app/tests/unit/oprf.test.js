import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ristretto255_oprf } from '@noble/curves/ed25519.js';
import { blind, finalize, deriveDisplayNameKey, deriveDeviceNameKey } from '../../src/lib/oprf/index.js';

describe('OPRF Library (src/lib/oprf/index.js)', () => {
  test('blind produces 32-byte blinded point and valid state handle', async () => {
    const res = await blind('alice');
    assert.ok(res.blindedBytes instanceof Uint8Array);
    assert.equal(res.blindedBytes.length, 32);
    assert.ok(res.state);
    assert.ok(res.state.blind instanceof Uint8Array);
    assert.equal(res.state.blind.length, 32);
    assert.ok(res.state.usernameBytes instanceof Uint8Array);
  });

  test('finalize produces 64-byte token digest given evaluated point and state', async () => {
    const { blindedBytes, state } = await blind('alice');
    // Derive server key via deriveKeyPair
    const seed = new Uint8Array(32).fill(42);
    const keyInfo = new TextEncoder().encode('username-oprf-v1');
    const { secretKey } = ristretto255_oprf.oprf.deriveKeyPair(seed, keyInfo);
    const evaluatedBytes = ristretto255_oprf.oprf.blindEvaluate(secretKey, blindedBytes);

    const token = await finalize('alice', evaluatedBytes, state);
    assert.ok(token instanceof Uint8Array);
    assert.equal(token.length, 64);
  });

  test('finalize is deterministic for identical inputs', async () => {
    const username = 'alice';
    const usernameBytes = new TextEncoder().encode(username);
    const { blind: blindScalar, blinded } = ristretto255_oprf.oprf.blind(usernameBytes);

    const seed = new Uint8Array(32).fill(42);
    const keyInfo = new TextEncoder().encode('username-oprf-v1');
    const { secretKey } = ristretto255_oprf.oprf.deriveKeyPair(seed, keyInfo);
    const evaluatedBytes = ristretto255_oprf.oprf.blindEvaluate(secretKey, blinded);

    const state = { blind: blindScalar, usernameBytes };

    const token1 = await finalize(username, evaluatedBytes, state);
    const token2 = await finalize(usernameBytes, evaluatedBytes, state);

    assert.deepEqual(token1, token2);
  });

  test('key derivations produce distinct 32-byte keys for same token', async () => {
    const token = new Uint8Array(64).fill(7);
    const displayNameKey = await deriveDisplayNameKey(token);
    const deviceNameKey = await deriveDeviceNameKey(token);

    assert.equal(displayNameKey.length, 32);
    assert.equal(deviceNameKey.length, 32);
    assert.notDeepEqual(displayNameKey, deviceNameKey);
  });

  test('handles multi-byte UTF-8 usernames correctly', async () => {
    const seed = new Uint8Array(32).fill(100);
    const keyInfo = new TextEncoder().encode('username-oprf-v1');
    const { secretKey } = ristretto255_oprf.oprf.deriveKeyPair(seed, keyInfo);

    for (const name of ['café', 'naïve', '🚀user']) {
      const { blindedBytes, state } = await blind(name);
      assert.equal(blindedBytes.length, 32);

      const evaluatedBytes = ristretto255_oprf.oprf.blindEvaluate(secretKey, blindedBytes);

      const token = await finalize(name, evaluatedBytes, state);
      assert.equal(token.length, 64);
    }
  });

  test('validates input shapes and throws TypeErrors', async () => {
    await assert.rejects(() => blind(123), TypeError);
    await assert.rejects(() => finalize('alice', new Uint8Array(31), {}), TypeError);
    await assert.rejects(() => finalize('alice', new Uint8Array(32), null), TypeError);
    await assert.rejects(() => deriveDisplayNameKey(new Uint8Array(32)), TypeError);
    await assert.rejects(() => deriveDeviceNameKey(new Uint8Array(32)), TypeError);
  });

  /**
   * Differential test against Rust voprf 0.5.0 reference vector from C-V-C report.
   *
   * Inputs:
   *   username: "alice"
   *   server seed key: [42u8; 32]
   *   domain separator: "username-oprf-v1"
   *
   * Expected Final Token Hex:
   *   136dcf0ba9870c4a7a5312bcc25e7c83cb100869b07f63f630da45370fa087c949056fb7f591fdc78dd577ee4843f04f2d74252645607c71cb182adf2d790e4d
   *
   * Expected Final Token Base64url (no pad):
   *   E23PC6mHDEp6UxK8wl58g8sQCGmwf2P2MNpFNw-gh8lJBW-39ZH9x43Vd-5IQ_BPLXQlJkVgfHHLGCrfLXkOTQ
   */
  test('byte-exact match against Rust voprf 0.5.0 reference vector (C-V-C)', async () => {
    const username = 'alice';
    const usernameBytes = new TextEncoder().encode(username);

    // Derive server secretKey using deriveKeyPair(seed, keyInfo)
    const seed = new Uint8Array(32).fill(42);
    const keyInfo = new TextEncoder().encode('username-oprf-v1');
    const { secretKey } = ristretto255_oprf.oprf.deriveKeyPair(seed, keyInfo);

    // Perform blind
    const { blindedBytes, state } = await blind(username);

    // Evaluate using derived secretKey
    const evaluatedBytes = ristretto255_oprf.oprf.blindEvaluate(secretKey, blindedBytes);

    // Finalize
    const token = await finalize(usernameBytes, evaluatedBytes, state);
    assert.equal(token.length, 64);

    const hex = Array.from(token).map((b) => b.toString(16).padStart(2, '0')).join('');
    assert.equal(
      hex,
      '136dcf0ba9870c4a7a5312bcc25e7c83cb100869b07f63f630da45370fa087c949056fb7f591fdc78dd577ee4843f04f2d74252645607c71cb182adf2d790e4d'
    );
  });
});
