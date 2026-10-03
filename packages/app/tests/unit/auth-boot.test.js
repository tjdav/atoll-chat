import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBootFlow, BootError } from '../../src/lib/auth/boot.js';
import { ApiError } from '../../src/lib/api/index.js';

function makeDeps(overrides = {}) {
  const navigateCalls = [];
  const cleared = { session: false, oprf: false };
  const stored = { oprfToken: null };

  const deps = {
    session: {
      getSessionToken: () => null,
      getUsername: () => null,
      setOprfToken: (t) => { stored.oprfToken = t; },
      clearSession: () => { cleared.session = true; }
    },
    api: {
      get: async () => { throw new Error('unexpected GET'); },
      post: async () => { throw new Error('unexpected POST'); }
    },
    oprf: {
      blind: async () => new Uint8Array(32),
      finalize: async () => new Uint8Array(64)
    },
    codec: {
      bytesToBase64: () => 'AAAA',
      base64ToBytes: () => new Uint8Array(32)
    },
    navigate: (url) => { navigateCalls.push(url); },
    ...overrides
  };

  return { deps, navigateCalls, cleared, stored };
}

describe('bootFlow library tests', () => {
  it('exports BootError class extending Error', () => {
    const err = new BootError('test_code', 'test message');
    assert.equal(err.name, 'BootError');
    assert.equal(err.code, 'test_code');
    assert.equal(err.message, 'test message');
    assert.ok(err instanceof Error);
  });

  it('redirects to /index.html when no session token exists', async () => {
    const { deps, navigateCalls } = makeDeps();
    const bootFlow = createBootFlow(deps);

    const result = await bootFlow();

    assert.deepEqual(navigateCalls, ['/index.html']);
    assert.deepEqual(result, { redirected: true, reason: 'no_session' });
  });

  it('clears session and redirects to /index.html when no username exists', async () => {
    const { deps, navigateCalls, cleared } = makeDeps({
      session: {
        getSessionToken: () => 'valid-token',
        getUsername: () => null,
        setOprfToken: () => {},
        clearSession: () => { cleared.session = true; }
      }
    });
    const bootFlow = createBootFlow(deps);

    const result = await bootFlow();

    assert.equal(cleared.session, true);
    assert.deepEqual(navigateCalls, ['/index.html']);
    assert.deepEqual(result, { redirected: true, reason: 'no_username' });
  });

  it('clears session and redirects on 401 session_expired', async () => {
    const { deps, navigateCalls, cleared } = makeDeps({
      session: {
        getSessionToken: () => 'valid-token',
        getUsername: () => 'alice',
        setOprfToken: () => {},
        clearSession: () => { cleared.session = true; }
      },
      api: {
        get: async (path) => {
          if (path === '/users/me') {
            throw new ApiError(401, 'unauthorized', 'Session expired');
          }
          throw new Error('unexpected GET');
        },
        post: async () => {}
      }
    });
    const bootFlow = createBootFlow(deps);

    const result = await bootFlow();

    assert.equal(cleared.session, true);
    assert.deepEqual(navigateCalls, ['/index.html']);
    assert.deepEqual(result, { redirected: true, reason: 'session_expired' });
  });

  it('clears session and redirects on 403 account_disabled', async () => {
    const { deps, navigateCalls, cleared } = makeDeps({
      session: {
        getSessionToken: () => 'valid-token',
        getUsername: () => 'alice',
        setOprfToken: () => {},
        clearSession: () => { cleared.session = true; }
      },
      api: {
        get: async (path) => {
          if (path === '/users/me') {
            throw new ApiError(403, 'forbidden', 'Account disabled');
          }
          throw new Error('unexpected GET');
        },
        post: async () => {}
      }
    });
    const bootFlow = createBootFlow(deps);

    const result = await bootFlow();

    assert.equal(cleared.session, true);
    assert.deepEqual(navigateCalls, ['/index.html']);
    assert.deepEqual(result, { redirected: true, reason: 'account_disabled' });
  });

  it('continues in degraded state with user=null on generic network error during /users/me', async () => {
    const mockUser = { id: 'u_123' };
    const { deps, navigateCalls, stored } = makeDeps({
      session: {
        getSessionToken: () => 'valid-token',
        getUsername: () => 'alice',
        setOprfToken: (t) => { stored.oprfToken = t; },
        clearSession: () => {}
      },
      api: {
        get: async (path) => {
          if (path === '/users/me') {
            throw new TypeError('Failed to fetch');
          }
          throw new Error('unexpected GET');
        },
        post: async (path) => {
          if (path === '/oprf/blind') {
            return { evaluated: 'AAAA' };
          }
          throw new Error('unexpected POST');
        }
      }
    });
    const bootFlow = createBootFlow(deps);

    const result = await bootFlow();

    assert.deepEqual(navigateCalls, []);
    assert.equal(result.redirected, false);
    assert.equal(result.hasOprfToken, true);
    assert.equal(result.user, null);
    assert.ok(stored.oprfToken instanceof Uint8Array);
    assert.equal(stored.oprfToken.length, 64);
  });

  it('successfully completes boot and re-derives OPRF token when all calls succeed', async () => {
    const mockUser = { id: 'u_123', username_token: 'token123' };
    const expectedOprfToken = new Uint8Array(64).fill(7);

    const { deps, navigateCalls, stored } = makeDeps({
      session: {
        getSessionToken: () => 'valid-token',
        getUsername: () => 'alice',
        setOprfToken: (t) => { stored.oprfToken = t; },
        clearSession: () => {}
      },
      api: {
        get: async (path) => {
          if (path === '/users/me') return mockUser;
          throw new Error('unexpected GET');
        },
        post: async (path, opts) => {
          if (path === '/oprf/blind') {
            assert.deepEqual(opts.body, { blinded: 'AAAA' });
            return { evaluated: 'BBBB' };
          }
          throw new Error('unexpected POST');
        }
      },
      oprf: {
        blind: async (username) => {
          assert.equal(username, 'alice');
          return { blindedBytes: new Uint8Array(32).fill(1), state: { blind: new Uint8Array(32) } };
        },
        finalize: async (username, evalBytes, state) => {
          assert.equal(username, 'alice');
          return expectedOprfToken;
        }
      }
    });

    const bootFlow = createBootFlow(deps);
    const result = await bootFlow();

    assert.deepEqual(navigateCalls, []);
    assert.equal(result.redirected, false);
    assert.equal(result.hasOprfToken, true);
    assert.deepEqual(result.user, mockUser);
    assert.deepEqual(stored.oprfToken, expectedOprfToken);
  });

  it('completes boot with hasOprfToken=false when OPRF endpoint fails', async () => {
    const mockUser = { id: 'u_123' };
    const { deps, navigateCalls, stored } = makeDeps({
      session: {
        getSessionToken: () => 'valid-token',
        getUsername: () => 'alice',
        setOprfToken: (t) => { stored.oprfToken = t; },
        clearSession: () => {}
      },
      api: {
        get: async (path) => {
          if (path === '/users/me') return mockUser;
          throw new Error('unexpected GET');
        },
        post: async (path) => {
          if (path === '/oprf/blind') {
            throw new ApiError(500, 'server_error', 'Internal server error');
          }
          throw new Error('unexpected POST');
        }
      }
    });

    const bootFlow = createBootFlow(deps);
    const result = await bootFlow();

    assert.deepEqual(navigateCalls, []);
    assert.equal(result.redirected, false);
    assert.equal(result.hasOprfToken, false);
    assert.deepEqual(result.user, mockUser);
    assert.equal(stored.oprfToken, null);
  });

  it('completes boot with hasOprfToken=false when oprf.blind throws locally', async () => {
    const mockUser = { id: 'u_123' };
    const { deps, navigateCalls, stored } = makeDeps({
      session: {
        getSessionToken: () => 'valid-token',
        getUsername: () => 'alice',
        setOprfToken: (t) => { stored.oprfToken = t; },
        clearSession: () => {}
      },
      api: {
        get: async (path) => {
          if (path === '/users/me') return mockUser;
          throw new Error('unexpected GET');
        }
      },
      oprf: {
        blind: async () => {
          throw new Error('Local crypto error');
        }
      }
    });

    const bootFlow = createBootFlow(deps);
    const result = await bootFlow();

    assert.deepEqual(navigateCalls, []);
    assert.equal(result.redirected, false);
    assert.equal(result.hasOprfToken, false);
    assert.deepEqual(result.user, mockUser);
    assert.equal(stored.oprfToken, null);
  });
});
