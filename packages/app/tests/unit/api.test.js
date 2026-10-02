import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from '../../src/lib/api/index.js';

describe('API Fetch Wrapper (src/lib/api/index.js)', () => {
  test('GET serializes query parameters and parses JSON', async () => {
    let capturedUrl = '';
    let capturedOptions = null;

    const fetchImpl = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ success: true, count: 5 }),
      };
    };

    const client = createApiClient({
      baseUrl: 'https://example.com/api/v1/',
      fetchImpl,
    });

    const res = await client.get('/items', { query: { page: 2, limit: 10, filter: 'active', empty: undefined, nullVal: null } });

    assert.equal(capturedUrl, 'https://example.com/api/v1/items?page=2&limit=10&filter=active');
    assert.equal(capturedOptions.method, 'GET');
    assert.deepEqual(res, { success: true, count: 5 });
  });

  test('POST applies JSON serialization and Content-Type header', async () => {
    let capturedOptions = null;

    const fetchImpl = async (url, options) => {
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ id: '123' }),
      };
    };

    const client = createApiClient({
      baseUrl: 'https://example.com/api/v1',
      fetchImpl,
    });

    const res = await client.post('/users', { body: { name: 'Alice' } });

    assert.equal(capturedOptions.method, 'POST');
    assert.equal(capturedOptions.headers['Content-Type'], 'application/json');
    assert.equal(capturedOptions.body, JSON.stringify({ name: 'Alice' }));
    assert.deepEqual(res, { id: '123' });
  });

  test('injects Authorization header when getAuthToken returns token', async () => {
    let capturedHeaders = null;

    const fetchImpl = async (url, options) => {
      capturedHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ ok: true }),
      };
    };

    const clientWithToken = createApiClient({
      baseUrl: 'https://example.com/api/v1',
      getAuthToken: async () => 'secret_bearer_token',
      fetchImpl,
    });

    await clientWithToken.get('/me');
    assert.equal(capturedHeaders['Authorization'], 'Bearer secret_bearer_token');

    const clientWithoutToken = createApiClient({
      baseUrl: 'https://example.com/api/v1',
      getAuthToken: () => null,
      fetchImpl,
    });

    await clientWithoutToken.get('/me');
    assert.equal('Authorization' in capturedHeaders, false);
  });

  test('returns null on HTTP 204 No Content response', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 204,
      headers: new Map(),
    });

    const client = createApiClient({
      baseUrl: 'https://example.com/api/v1',
      fetchImpl,
    });

    const res = await client.del('/items/123');
    assert.equal(res, null);
  });

  test('returns text body when Content-Type is non-JSON', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => 'hello world',
    });

    const client = createApiClient({
      baseUrl: 'https://example.com/api/v1',
      fetchImpl,
    });

    const res = await client.get('/text');
    assert.equal(res, 'hello world');
  });

  test('normalizes 400 error response with JSON error code', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 400,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ error: 'invalid_request', message: 'Field missing', details: { field: 'email' } }),
    });

    const client = createApiClient({
      baseUrl: 'https://example.com/api/v1',
      fetchImpl,
    });

    await assert.rejects(
      async () => client.post('/test', { body: {} }),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 400);
        assert.equal(err.code, 'invalid_request');
        assert.equal(err.message, 'Field missing');
        assert.deepEqual(err.details, { field: 'email' });
        return true;
      }
    );
  });

  test('normalizes non-JSON error response into ApiError with unknown code', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Map([['content-type', 'text/html']]),
      text: async () => '500 Server Failure',
    });

    const client = createApiClient({
      baseUrl: 'https://example.com/api/v1',
      fetchImpl,
    });

    await assert.rejects(
      async () => client.get('/fail'),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 500);
        assert.equal(err.code, 'unknown');
        assert.equal(err.message, '500 Server Failure');
        assert.equal(err.details, null);
        return true;
      }
    );
  });

  test('propagates AbortSignal to fetchImpl', async () => {
    let capturedSignal = null;
    const controller = new AbortController();

    const fetchImpl = async (url, options) => {
      capturedSignal = options.signal;
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ ok: true }),
      };
    };

    const client = createApiClient({
      baseUrl: 'https://example.com/api/v1',
      fetchImpl,
    });

    await client.get('/ping', { signal: controller.signal });
    assert.equal(capturedSignal, controller.signal);
  });
});
