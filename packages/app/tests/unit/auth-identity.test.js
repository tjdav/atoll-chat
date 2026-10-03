import test from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  generateIdentityKeypair,
  getIdentityPublicKey,
  getIdentityPrivateKey,
  setIdentityKeypair,
  clearIdentityKeypair,
} from '../../src/lib/auth/identity.js';

test('generateIdentityKeypair returns 32-byte private and public keys matching ed25519 derivation', async () => {
  const keypair = await generateIdentityKeypair();

  assert.ok(keypair.privateKey instanceof Uint8Array);
  assert.equal(keypair.privateKey.length, 32);
  assert.ok(keypair.publicKey instanceof Uint8Array);
  assert.equal(keypair.publicKey.length, 32);

  const derivedPublic = ed25519.getPublicKey(keypair.privateKey);
  assert.deepEqual(keypair.publicKey, derivedPublic);
});

test('setIdentityKeypair followed by getters returns identical bytes', async () => {
  clearIdentityKeypair();

  const keypair = await generateIdentityKeypair();
  setIdentityKeypair(keypair.privateKey, keypair.publicKey);

  const storedPriv = getIdentityPrivateKey();
  const storedPub = getIdentityPublicKey();

  assert.deepEqual(storedPriv, keypair.privateKey);
  assert.deepEqual(storedPub, keypair.publicKey);

  clearIdentityKeypair();
});

test('clearIdentityKeypair removes stored keys', async () => {
  const keypair = await generateIdentityKeypair();
  setIdentityKeypair(keypair.privateKey, keypair.publicKey);

  clearIdentityKeypair();

  assert.equal(getIdentityPrivateKey(), null);
  assert.equal(getIdentityPublicKey(), null);
});

test('in-memory storage fallback works when localStorage throws', async () => {
  clearIdentityKeypair();

  const originalLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('localStorage disabled');
    },
  });

  try {
    const keypair = await generateIdentityKeypair();
    setIdentityKeypair(keypair.privateKey, keypair.publicKey);

    assert.deepEqual(getIdentityPrivateKey(), keypair.privateKey);
    assert.deepEqual(getIdentityPublicKey(), keypair.publicKey);

    clearIdentityKeypair();
    assert.equal(getIdentityPrivateKey(), null);
    assert.equal(getIdentityPublicKey(), null);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
  }
});
