import test from 'node:test';
import assert from 'node:assert/strict';
import { RevocationHandler } from '../../src/lib/auth/revocation.js';

test('RevocationHandler unit tests', async (t) => {
  await t.test('session.revoked event triggers clearSession and navigate', () => {
    let clearCalls = 0;
    let navigatedTo = null;

    const fakeSession = {
      clearSession() {
        clearCalls++;
      }
    };

    const handler = new RevocationHandler({
      session: fakeSession,
      navigate(url) {
        navigatedTo = url;
      }
    });

    handler.handle('session.revoked', { reason: 'recovery' });

    assert.equal(clearCalls, 1);
    assert.equal(navigatedTo, '/index.html');
  });

  await t.test('account.disabled event triggers clearSession and navigate', () => {
    let clearCalls = 0;
    let navigatedTo = null;

    const fakeSession = {
      clearSession() {
        clearCalls++;
      }
    };

    const handler = new RevocationHandler({
      session: fakeSession,
      navigate(url) {
        navigatedTo = url;
      }
    });

    handler.handle('account.disabled');

    assert.equal(clearCalls, 1);
    assert.equal(navigatedTo, '/index.html');
  });

  await t.test('account.deleted event triggers clearSession and navigate', () => {
    let clearCalls = 0;
    let navigatedTo = null;

    const fakeSession = {
      clearSession() {
        clearCalls++;
      }
    };

    const handler = new RevocationHandler({
      session: fakeSession,
      navigate(url) {
        navigatedTo = url;
      }
    });

    handler.handle('account.deleted');

    assert.equal(clearCalls, 1);
    assert.equal(navigatedTo, '/index.html');
  });

  await t.test('unrecognized event types perform no-op', () => {
    let clearCalls = 0;
    let navigatedTo = null;

    const fakeSession = {
      clearSession() {
        clearCalls++;
      }
    };

    const handler = new RevocationHandler({
      session: fakeSession,
      navigate(url) {
        navigatedTo = url;
      }
    });

    handler.handle('room.created');
    handler.handle('message.sent');

    assert.equal(clearCalls, 0);
    assert.equal(navigatedTo, null);
  });
});
