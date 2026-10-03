import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLogin, finishLogin } from '../../src/lib/auth/opaque.js';

test('startLogin returns clientLoginState handle and startLoginRequest base64url string', async () => {
  const result = await startLogin({ password: 'user-password-123' });
  assert.equal(typeof result, 'object');
  assert.equal(typeof result.clientLoginState, 'string');
  assert.equal(typeof result.startLoginRequest, 'string');
  assert.equal(result.startLoginRequest.includes('+'), false);
  assert.equal(result.startLoginRequest.includes('/'), false);
  assert.equal(result.startLoginRequest.includes('='), false);
});

test('finishLogin returns null when given invalid/mismatched credential response', async () => {
  const start = await startLogin({ password: 'user-password-123' });

  // Fabricated response string in standard Base64
  const fabricatedResponseB64 = Buffer.from(new Uint8Array(320).fill(1)).toString('base64');

  const finish = await finishLogin({
    clientLoginState: start.clientLoginState,
    loginResponse: fabricatedResponseB64,
    password: 'user-password-123',
  });

  assert.equal(finish, null);
});
