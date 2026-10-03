import test from 'node:test';
import assert from 'node:assert/strict';
import * as opaque from '@serenity-kit/opaque';
import { createRegisterFlow, RegisterError } from '../../src/lib/auth/flows.js';
import { getSessionToken, getUsername } from '../../src/lib/auth/session.js';
import { getIdentityPrivateKey, getIdentityPublicKey } from '../../src/lib/auth/identity.js';

test('auth register flow unit tests with simulated OPAQUE server', async (t) => {
  if (opaque.ready) {
    await opaque.ready;
  }

  const serverSetup = opaque.server.createSetup();

  /**
   * Builds fake dependency bundle for register flow tests.
   */
  function buildFakeDeps(options = {}) {
    const serverUsers = new Map(); // tokenStr -> { registrationResponse }
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

        if (path === '/auth/register/start') {
          if (options.registerStartApiError) {
            const { ApiError } = await import('../../src/lib/api/index.js');
            throw new ApiError(
              options.registerStartApiError.status,
              options.registerStartApiError.code,
              options.registerStartApiError.message
            );
          }

          const { username_token, opaque_client_registration_state } = body;
          const { registrationResponse } = opaque.server.createRegistrationResponse({
            serverSetup,
            userIdentifier: username_token,
            registrationRequest: opaque_client_registration_state
          });

          serverUsers.set(username_token, { registrationResponse });
          return { registration_response: registrationResponse };
        }

        if (path === '/auth/register/finish') {
          if (options.registerFinishApiStatus) {
            const { ApiError } = await import('../../src/lib/api/index.js');
            throw new ApiError(options.registerFinishApiStatus, 'server_error', 'Finish error');
          }

          const { username_token, opaque_record } = body;
          const userObj = serverUsers.get(username_token);
          if (userObj) {
            userObj.record = opaque_record;
          }

          return {
            session_token: 'test-session-token-123',
            user_id: 'u_test_user_456',
            recovery_codes: ['REC1-AAAA', 'REC2-BBBB', 'REC3-CCCC']
          };
        }

        throw new Error(`Unexpected path: ${path}`);
      }
    };

    return {
      fakeOprf,
      fakeApi,
      serverUsers,
      apiCalls
    };
  }

  await t.test('Happy path registration completes successfully', async () => {
    const { fakeOprf, fakeApi, serverUsers } = buildFakeDeps();
    const register = createRegisterFlow({ oprf: fakeOprf, api: fakeApi });

    const result = await register({
      inviteCode: 'INVITE123',
      altcha: 'altcha-payload',
      username: 'alice',
      displayName: 'Alice',
      password: 'hunter2Password!'
    });

    assert.equal(result.sessionToken, 'test-session-token-123');
    assert.equal(result.userId, 'u_test_user_456');
    assert.deepEqual(result.recoveryCodes, ['REC1-AAAA', 'REC2-BBBB', 'REC3-CCCC']);
    assert.equal(result.identityPrivateKey.length, 32);
    assert.equal(result.identityPublicKey.length, 32);
    assert.equal(result.oprfToken.length, 64);
    assert.equal(result.username, 'alice');

    assert.equal(serverUsers.size, 1);
    const userEntry = Array.from(serverUsers.values())[0];
    assert.ok(userEntry.record);
    assert.ok(typeof userEntry.record === 'string');
  });

  await t.test('Display name exceeding 256 bytes throws RegisterError(display_name_invalid)', async () => {
    const { fakeOprf, fakeApi, apiCalls } = buildFakeDeps();
    const register = createRegisterFlow({ oprf: fakeOprf, api: fakeApi });

    const longDisplayName = 'a'.repeat(257);

    await assert.rejects(
      async () => register({
        inviteCode: 'INVITE123',
        username: 'alice',
        displayName: longDisplayName,
        password: 'password123'
      }),
      (err) => {
        assert.ok(err instanceof RegisterError);
        assert.equal(err.code, 'display_name_invalid');
        return true;
      }
    );

    assert.equal(apiCalls.filter((c) => c.path === '/auth/register/start').length, 0);
  });

  await t.test('Invite code rejected returns RegisterError(invite_invalid)', async () => {
    const { fakeOprf, fakeApi } = buildFakeDeps({
      registerStartApiError: { status: 400, code: 'invite_invalid', message: 'Invalid invite' }
    });
    const register = createRegisterFlow({ oprf: fakeOprf, api: fakeApi });

    await assert.rejects(
      async () => register({
        inviteCode: 'BADINVITE',
        username: 'alice',
        displayName: 'Alice',
        password: 'password123'
      }),
      (err) => {
        assert.ok(err instanceof RegisterError);
        assert.equal(err.code, 'invite_invalid');
        assert.equal(err.message, 'That invite code is not valid or has expired.');
        return true;
      }
    );
  });

  await t.test('ALTCHA rejected returns RegisterError(altcha_failed)', async () => {
    const { fakeOprf, fakeApi } = buildFakeDeps({
      registerStartApiError: { status: 400, code: 'altcha_failed', message: 'Altcha failed' }
    });
    const register = createRegisterFlow({ oprf: fakeOprf, api: fakeApi });

    await assert.rejects(
      async () => register({
        altcha: 'bad-altcha',
        username: 'alice',
        displayName: 'Alice',
        password: 'password123'
      }),
      (err) => {
        assert.ok(err instanceof RegisterError);
        assert.equal(err.code, 'altcha_failed');
        assert.equal(err.message, 'Verification failed. Try again.');
        return true;
      }
    );
  });

  await t.test('Username taken returns RegisterError(username_taken)', async () => {
    const { fakeOprf, fakeApi } = buildFakeDeps({
      registerStartApiError: { status: 409, code: 'username_exists', message: 'Conflict' }
    });
    const register = createRegisterFlow({ oprf: fakeOprf, api: fakeApi });

    await assert.rejects(
      async () => register({
        username: 'alice',
        displayName: 'Alice',
        password: 'password123'
      }),
      (err) => {
        assert.ok(err instanceof RegisterError);
        assert.equal(err.code, 'username_taken');
        assert.equal(err.message, 'That username is already in use.');
        return true;
      }
    );
  });

  await t.test('OPRF network error returns RegisterError(network)', async () => {
    const { fakeOprf, fakeApi } = buildFakeDeps({ oprfBlindApiStatus: 500 });
    const register = createRegisterFlow({ oprf: fakeOprf, api: fakeApi });

    await assert.rejects(
      async () => register({
        username: 'alice',
        displayName: 'Alice',
        password: 'password123'
      }),
      (err) => {
        assert.ok(err instanceof RegisterError);
        assert.equal(err.code, 'network');
        assert.equal(err.message, 'The server had a problem. Try again.');
        return true;
      }
    );
  });

  await t.test('Server error on register finish returns RegisterError(network)', async () => {
    const { fakeOprf, fakeApi } = buildFakeDeps({ registerFinishApiStatus: 502 });
    const register = createRegisterFlow({ oprf: fakeOprf, api: fakeApi });

    await assert.rejects(
      async () => register({
        username: 'alice',
        displayName: 'Alice',
        password: 'password123'
      }),
      (err) => {
        assert.ok(err instanceof RegisterError);
        assert.equal(err.code, 'network');
        assert.equal(err.message, 'The server had a problem. Try again.');
        return true;
      }
    );
  });

  await t.test('Register flow does NOT persist session or identity key state', async () => {
    const { fakeOprf, fakeApi } = buildFakeDeps();
    const register = createRegisterFlow({ oprf: fakeOprf, api: fakeApi });

    const initialSession = getSessionToken();
    const initialUsername = getUsername();
    const initialPriv = getIdentityPrivateKey();
    const initialPub = getIdentityPublicKey();

    await register({
      username: 'alice',
      displayName: 'Alice',
      password: 'password123'
    });

    assert.equal(getSessionToken(), initialSession);
    assert.equal(getUsername(), initialUsername);
    assert.deepEqual(getIdentityPrivateKey(), initialPriv);
    assert.deepEqual(getIdentityPublicKey(), initialPub);
  });
});
