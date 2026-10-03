import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as opaque from '@serenity-kit/opaque';
import { createLoginFlow, LoginError } from '../../src/lib/auth/flows.js';
import { ApiError } from '../../src/lib/api/index.js';
import { base64urlToBase64, base64ToBase64url } from '../../src/lib/codec/index.js';

test('createLoginFlow end-to-end happy path with server OPAQUE simulation', async () => {
  if (opaque.ready) {
    await opaque.ready;
  }

  // 1. Setup server and register user
  const serverSetup = opaque.server.createSetup();
  const password = 'my-secure-password-42';
  const regStart = opaque.client.startRegistration({ password });

  const { registrationResponse: regResponseUrl } = opaque.server.createRegistrationResponse({
    serverSetup,
    registrationRequest: regStart.registrationRequest,
    userIdentifier: 'user-id-alice',
  });

  const regFinish = opaque.client.finishRegistration({
    password,
    registrationResponse: regResponseUrl,
    clientRegistrationState: regStart.clientRegistrationState,
  });

  const serverRegistration = regFinish.registrationRecord;

  // 2. Prepare mock dependencies for createLoginFlow
  const oprfTokenBytes = new Uint8Array(64).fill(7);
  const mockOprf = {
    async blind(username) {
      return {
        blindedBytes: new Uint8Array(32).fill(1),
        state: { username },
      };
    },
    async finalize(username, evaluatedBytes, state) {
      return oprfTokenBytes;
    },
  };

  let serverLoginState = null;

  const mockApi = {
    async post(path, { body }) {
      if (path === '/oprf/blind') {
        return { evaluated: Buffer.from(new Uint8Array(32).fill(2)).toString('base64') };
      }
      if (path === '/auth/login/start') {
        const res = opaque.server.startLogin({
          serverSetup,
          registrationRecord: serverRegistration,
          startLoginRequest: body.opaque_client_auth_state,
          userIdentifier: 'user-id-alice',
        });
        serverLoginState = res.serverLoginState;
        return { credential_response: base64urlToBase64(res.loginResponse) };
      }
      if (path === '/auth/login/finish') {
        const finishRes = opaque.server.finishLogin({
          serverLoginState,
          finishLoginRequest: body.ke3,
        });
        assert.equal(typeof finishRes.sessionKey, 'string');
        return { session_token: 'mocked-server-session-token-999' };
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  };

  let storedSessionToken = null;
  let storedOprfToken = null;
  let storedUsername = null;

  const mockSession = {
    setSessionToken(t) {
      storedSessionToken = t;
    },
    setOprfToken(bytes) {
      storedOprfToken = bytes;
    },
    setUsername(u) {
      storedUsername = u;
    },
  };

  const loginFlow = createLoginFlow({
    oprf: mockOprf,
    api: mockApi,
    session: mockSession,
  });

  const result = await loginFlow({ username: 'alice', password });

  assert.equal(result.sessionToken, 'mocked-server-session-token-999');
  assert.equal(storedSessionToken, 'mocked-server-session-token-999');
  assert.deepEqual(storedOprfToken, oprfTokenBytes);
  assert.equal(storedUsername, 'alice');
});

test('createLoginFlow throws LoginError invalid_credentials when password is wrong', async () => {
  if (opaque.ready) {
    await opaque.ready;
  }

  const serverSetup = opaque.server.createSetup();
  const password = 'correct-password';
  const regStart = opaque.client.startRegistration({ password });

  const { registrationResponse: regResponseUrl } = opaque.server.createRegistrationResponse({
    serverSetup,
    registrationRequest: regStart.registrationRequest,
    userIdentifier: 'user-id-alice',
  });

  const regFinish = opaque.client.finishRegistration({
    password,
    registrationResponse: regResponseUrl,
    clientRegistrationState: regStart.clientRegistrationState,
  });

  const serverRegistration = regFinish.registrationRecord;

  const mockOprf = {
    async blind(username) {
      return {
        blindedBytes: new Uint8Array(32).fill(1),
        state: { username },
      };
    },
    async finalize(username, evaluatedBytes) {
      return new Uint8Array(64).fill(7);
    },
  };

  let serverLoginState = null;

  const mockApi = {
    async post(path, { body }) {
      if (path === '/oprf/blind') {
        return { evaluated: Buffer.from(new Uint8Array(32).fill(2)).toString('base64') };
      }
      if (path === '/auth/login/start') {
        const res = opaque.server.startLogin({
          serverSetup,
          registrationRecord: serverRegistration,
          startLoginRequest: body.opaque_client_auth_state,
          userIdentifier: 'user-id-alice',
        });
        serverLoginState = res.serverLoginState;
        return { credential_response: base64urlToBase64(res.loginResponse) };
      }
      if (path === '/auth/login/finish') {
        return { session_token: 'should-not-be-reached' };
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  };

  let written = false;
  const mockSession = {
    setSessionToken() {
      written = true;
    },
    setOprfToken() {
      written = true;
    },
    setUsername() {
      written = true;
    },
  };

  const loginFlow = createLoginFlow({
    oprf: mockOprf,
    api: mockApi,
    session: mockSession,
  });

  await assert.rejects(
    async () => {
      await loginFlow({ username: 'alice', password: 'wrong-password' });
    },
    (err) => {
      assert.equal(err instanceof LoginError, true);
      assert.equal(err.code, 'invalid_credentials');
      return true;
    }
  );

  assert.equal(written, false);
});

test('createLoginFlow propagates ApiError on server error', async () => {
  const mockOprf = {
    async blind(username) {
      return {
        blindedBytes: new Uint8Array(32).fill(1),
        state: { username },
      };
    },
    async finalize() {
      return new Uint8Array(64).fill(7);
    },
  };

  const mockApi = {
    async post(path) {
      if (path === '/oprf/blind') {
        return { evaluated: Buffer.from(new Uint8Array(32).fill(2)).toString('base64') };
      }
      if (path === '/auth/login/start') {
        throw new ApiError(500, 'internal_error', 'Internal server error');
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  };

  let written = false;
  const mockSession = {
    setSessionToken() {
      written = true;
    },
    setOprfToken() {
      written = true;
    },
    setUsername() {
      written = true;
    },
  };

  const loginFlow = createLoginFlow({
    oprf: mockOprf,
    api: mockApi,
    session: mockSession,
  });

  await assert.rejects(
    async () => {
      await loginFlow({ username: 'alice', password: 'password' });
    },
    (err) => {
      assert.equal(err instanceof ApiError, true);
      assert.equal(err.status, 500);
      return true;
    }
  );

  assert.equal(written, false);
});

test('createLoginFlow propagates ApiError when OPRF endpoint fails', async () => {
  const mockOprf = {
    async blind(username) {
      return {
        blindedBytes: new Uint8Array(32).fill(1),
        state: { username },
      };
    },
    async finalize() {
      return new Uint8Array(64).fill(7);
    },
  };

  const mockApi = {
    async post(path) {
      if (path === '/oprf/blind') {
        throw new ApiError(400, 'invalid_blinded', 'Invalid blinded point');
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  };

  let written = false;
  const mockSession = {
    setSessionToken() {
      written = true;
    },
    setOprfToken() {
      written = true;
    },
    setUsername() {
      written = true;
    },
  };

  const loginFlow = createLoginFlow({
    oprf: mockOprf,
    api: mockApi,
    session: mockSession,
  });

  await assert.rejects(
    async () => {
      await loginFlow({ username: 'alice', password: 'password' });
    },
    (err) => {
      assert.equal(err instanceof ApiError, true);
      assert.equal(err.status, 400);
      return true;
    }
  );

  assert.equal(written, false);
});
