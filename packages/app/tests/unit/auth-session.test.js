import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setSessionToken,
  getSessionToken,
  clearSessionToken,
  setOprfToken,
  getOprfToken,
  clearOprfToken,
  setUsername,
  getUsername,
  clearUsername,
  clearSession,
} from '../../src/lib/auth/session.js';

test('session token getters and setters work correctly', () => {
  clearSessionToken();
  assert.equal(getSessionToken(), null);

  setSessionToken('test-session-token-123');
  assert.equal(getSessionToken(), 'test-session-token-123');

  clearSessionToken();
  assert.equal(getSessionToken(), null);
});

test('OPRF token getters and setters manage ephemeral Uint8Array state in memory', () => {
  clearOprfToken();
  assert.equal(getOprfToken(), null);

  const tokenBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  setOprfToken(tokenBytes);

  const retrieved = getOprfToken();
  assert.deepEqual(retrieved, tokenBytes);
  assert.notEqual(retrieved, tokenBytes); // returns defensive copy

  clearOprfToken();
  assert.equal(getOprfToken(), null);
});

test('username getters and setters work correctly', () => {
  clearUsername();
  assert.equal(getUsername(), null);

  setUsername('alice');
  assert.equal(getUsername(), 'alice');

  clearUsername();
  assert.equal(getUsername(), null);
});

test('clearSession clears all token and username stores', () => {
  setSessionToken('session-val');
  setOprfToken(new Uint8Array([10, 20, 30]));
  setUsername('bob');

  clearSession();

  assert.equal(getSessionToken(), null);
  assert.equal(getOprfToken(), null);
  assert.equal(getUsername(), null);
});

test('storage fallback operates when localStorage throws on access', () => {
  const originalLocalStorage = globalThis.localStorage;

  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('Access denied to localStorage');
      },
    });

    clearSessionToken();
    assert.equal(getSessionToken(), null);

    setSessionToken('fallback-session-token');
    assert.equal(getSessionToken(), 'fallback-session-token');

    clearSessionToken();
    assert.equal(getSessionToken(), null);
  } finally {
    if (originalLocalStorage !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      });
    } else {
      delete globalThis.localStorage;
    }
  }
});
