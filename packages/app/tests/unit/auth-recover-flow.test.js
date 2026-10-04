import test from 'node:test';
import assert from 'node:assert/strict';
import * as opaque from '@serenity-kit/opaque';
import { createRecoverFlow, RecoverError } from '../../src/lib/auth/flows.js';
import { getSessionToken, getUsername } from '../../src/lib/auth/session.js';

test('auth recover flow unit tests with simulated OPAQUE server', async (t) => {
  if (opaque.ready) {
    await opaque.ready;
  }

  const serverSetup = opaque.server.createSetup();

  /**
   * Builds fake dependency bundle for recover flow tests.
   */
  function buildFakeDeps(options = {}) {
    const activeSessions = new Map(); // recovery_session -> { usernameToken, registrationResponse }
    const apiCalls = [];

    const fakeOprf = {
      async blind(username) {
        if (options.oprfBlindError) {
          throw new Error(options.oprfBlindError);
        }
        return {
          blindedBytes: new Uint8Array(32).fill(0xaa),
          state: { username }
        };
      },
      async finalize(username, evaluatedBytes) {
        if (options.oprfFinalizeError) {
          throw new Error(options.oprfFinalizeError);
        }
        return new Uint8Array(64).fill(0xbb);
      },
      async deriveDisplayNameKey(tokenBytes) {
        return new Uint8Array(32).fill(0xcc);
      }
    };

    const fakeOpaque = {
      async startRegistration({ password }) {
        if (options.opaqueStartError) {
          throw new Error(options.opaqueStartError);
        }
        return opaque.client.startRegistration({ password });
      },
      async finishRegistration({ clientRegistrationState, registrationResponse, password }) {
        if (options.opaqueFinishError) {
          throw new Error(options.opaqueFinishError);
        }
        return opaque.client.finishRegistration({
          clientRegistrationState,
          registrationResponse,
          password
        });
      }
    };

    const fakeApi = {
      async post(path, { body } = {}) {
        apiCalls.push({ path, body });

        if (path === '/oprf/blind') {
          if (options.oprfBlindApiStatus) {
            const { ApiError } = await import('../../src/lib/api/index.js');
            throw new ApiError(options.oprfBlindApiStatus, 'server_error', 'OPRF error');
          }
          return { evaluated: 'A'.repeat(88) }; // base64 evaluated point
        }

        if (path === '/auth/recover/start') {
          if (options.recoverStartApiError) {
            const { ApiError } = await import('../../src/lib/api/index.js');
            throw new ApiError(
              options.recoverStartApiError.status,
              options.recoverStartApiError.code,
              options.recoverStartApiError.message
            );
          }

          const { recovery_code, username_token } = body;
          if (recovery_code !== 'GOOD-CODE') {
            const { ApiError } = await import('../../src/lib/api/index.js');
            throw new ApiError(404, 'recovery_failed', 'Recovery failed.');
          }

          // Generate client registration request using serverSetup / test params
          const mockClientStart = await opaque.client.startRegistration({ password: 'newPassword123!' });
          const { registrationResponse } = opaque.server.createRegistrationResponse({
            serverSetup,
            userIdentifier: username_token,
            registrationRequest: mockClientStart.registrationRequest
          });

          const recSession = 'rs_test_session_789';
          activeSessions.set(recSession, { username_token, registrationResponse });
          return {
            recovery_session: recSession,
            registration_response: registrationResponse
          };
        }

        if (path === '/auth/recover/finish') {
          if (options.recoverFinishApiStatus) {
            const { ApiError } = await import('../../src/lib/api/index.js');
            throw new ApiError(options.recoverFinishApiStatus, 'session_expired', 'Session expired');
          }

          const { recovery_session, opaque_record } = body;
          if (!activeSessions.has(recovery_session)) {
            const { ApiError } = await import('../../src/lib/api/index.js');
            throw new ApiError(401, 'session_expired', 'Session expired');
          }

          activeSessions.delete(recovery_session);
          return {
            session_token: 'new-session-token-999',
            user_id: 'u_recovered_user_123'
          };
        }

        throw new Error(`Unexpected path: ${path}`);
      }
    };

    return {
      fakeOprf,
      fakeOpaque,
      fakeApi,
      activeSessions,
      apiCalls
    };
  }

  await t.test('Happy path recovery completes successfully', async () => {
    const { fakeOprf, fakeOpaque, fakeApi } = buildFakeDeps();
    const recover = createRecoverFlow({ oprf: fakeOprf, opaque: fakeOpaque, api: fakeApi });

    const result = await recover({
      username: 'alice',
      recoveryCode: 'GOOD-CODE',
      displayName: 'Alice Recovered',
      newPassword: 'newPassword123!'
    });

    assert.equal(result.sessionToken, 'new-session-token-999');
    assert.equal(result.userId, 'u_recovered_user_123');
    assert.equal(result.identityPrivateKey.length, 32);
    assert.equal(result.identityPublicKey.length, 32);
    assert.equal(result.oprfToken.length, 64);
    assert.equal(result.username, 'alice');
  });

  await t.test('Invalid recovery code returns RecoverError(recovery_invalid)', async () => {
    const { fakeOprf, fakeApi } = buildFakeDeps();
    const recover = createRecoverFlow({ oprf: fakeOprf, api: fakeApi });

    await assert.rejects(
      async () => recover({
        username: 'alice',
        recoveryCode: 'BAD-CODE',
        displayName: 'Alice',
        newPassword: 'newPassword123!'
      }),
      (err) => {
        assert.ok(err instanceof RecoverError);
        assert.equal(err.code, 'recovery_invalid');
        assert.equal(err.message, 'That recovery code does not match this account.');
        return true;
      }
    );
  });

  await t.test('Rate limited on start returns RecoverError(rate_limited)', async () => {
    const { fakeOprf, fakeApi } = buildFakeDeps({
      recoverStartApiError: { status: 429, code: 'rate_limited', message: 'Rate limited' }
    });
    const recover = createRecoverFlow({ oprf: fakeOprf, api: fakeApi });

    await assert.rejects(
      async () => recover({
        username: 'alice',
        recoveryCode: 'GOOD-CODE',
        displayName: 'Alice',
        newPassword: 'newPassword123!'
      }),
      (err) => {
        assert.ok(err instanceof RecoverError);
        assert.equal(err.code, 'rate_limited');
        assert.equal(err.message, 'Too many attempts. Try again in a moment.');
        return true;
      }
    );
  });

  await t.test('Expired recovery session on finish returns RecoverError(recovery_expired)', async () => {
    const { fakeOprf, fakeOpaque, fakeApi } = buildFakeDeps({ recoverFinishApiStatus: 401 });
    const recover = createRecoverFlow({ oprf: fakeOprf, opaque: fakeOpaque, api: fakeApi });

    await assert.rejects(
      async () => recover({
        username: 'alice',
        recoveryCode: 'GOOD-CODE',
        displayName: 'Alice',
        newPassword: 'newPassword123!'
      }),
      (err) => {
        assert.ok(err instanceof RecoverError);
        assert.equal(err.code, 'recovery_expired');
        assert.equal(err.message, 'Your recovery session expired. Start again.');
        return true;
      }
    );
  });

  await t.test('Server error on start returns RecoverError(network)', async () => {
    const { fakeOprf, fakeApi } = buildFakeDeps({
      recoverStartApiError: { status: 500, code: 'server_error', message: 'Internal error' }
    });
    const recover = createRecoverFlow({ oprf: fakeOprf, api: fakeApi });

    await assert.rejects(
      async () => recover({
        username: 'alice',
        recoveryCode: 'GOOD-CODE',
        displayName: 'Alice',
        newPassword: 'newPassword123!'
      }),
      (err) => {
        assert.ok(err instanceof RecoverError);
        assert.equal(err.code, 'network');
        assert.equal(err.message, 'The server had a problem. Try again.');
        return true;
      }
    );
  });

  await t.test('Server error on finish returns RecoverError(network)', async () => {
    const { fakeOprf, fakeOpaque, fakeApi } = buildFakeDeps({ recoverFinishApiStatus: 502 });
    const recover = createRecoverFlow({ oprf: fakeOprf, opaque: fakeOpaque, api: fakeApi });

    await assert.rejects(
      async () => recover({
        username: 'alice',
        recoveryCode: 'GOOD-CODE',
        displayName: 'Alice',
        newPassword: 'newPassword123!'
      }),
      (err) => {
        assert.ok(err instanceof RecoverError);
        assert.equal(err.code, 'network');
        assert.equal(err.message, 'The server had a problem. Try again.');
        return true;
      }
    );
  });

  await t.test('OPRF blind failure returns RecoverError(network)', async () => {
    const { fakeOprf, fakeApi } = buildFakeDeps({ oprfBlindApiStatus: 500 });
    const recover = createRecoverFlow({ oprf: fakeOprf, api: fakeApi });

    await assert.rejects(
      async () => recover({
        username: 'alice',
        recoveryCode: 'GOOD-CODE',
        displayName: 'Alice',
        newPassword: 'newPassword123!'
      }),
      (err) => {
        assert.ok(err instanceof RecoverError);
        assert.equal(err.code, 'network');
        assert.equal(err.message, 'The server had a problem. Try again.');
        return true;
      }
    );
  });

  await t.test('Display name exceeding 256 bytes throws RecoverError(display_name_invalid) before start call', async () => {
    const { fakeOprf, fakeApi, apiCalls } = buildFakeDeps();
    const recover = createRecoverFlow({ oprf: fakeOprf, api: fakeApi });

    const longDisplayName = 'a'.repeat(257);

    await assert.rejects(
      async () => recover({
        username: 'alice',
        recoveryCode: 'GOOD-CODE',
        displayName: longDisplayName,
        newPassword: 'newPassword123!'
      }),
      (err) => {
        assert.ok(err instanceof RecoverError);
        assert.equal(err.code, 'display_name_invalid');
        return true;
      }
    );

    assert.equal(apiCalls.filter((c) => c.path === '/auth/recover/start').length, 0);
  });

  await t.test('Recover flow does NOT persist session state internally', async () => {
    const { fakeOprf, fakeOpaque, fakeApi } = buildFakeDeps();
    const recover = createRecoverFlow({ oprf: fakeOprf, opaque: fakeOpaque, api: fakeApi });

    const initialSession = getSessionToken();
    const initialUsername = getUsername();

    await recover({
      username: 'alice',
      recoveryCode: 'GOOD-CODE',
      displayName: 'Alice',
      newPassword: 'newPassword123!'
    });

    assert.equal(getSessionToken(), initialSession);
    assert.equal(getUsername(), initialUsername);
  });
});
