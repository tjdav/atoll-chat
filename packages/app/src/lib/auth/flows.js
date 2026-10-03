import { ApiError } from '../api/index.js';
import { bytesToBase64url, base64urlToBytes } from '../codec/index.js';

/**
 * Error thrown during login flow execution.
 */
export class LoginError extends Error {
  /**
   * @param {string} code Error code string (e.g. "invalid_credentials", "network", "unknown")
   * @param {string} message Descriptive error message
   */
  constructor(code, message) {
    super(message);
    this.name = 'LoginError';
    this.code = code;
  }
}

/**
 * Helper to encode a Uint8Array into a standard Base64 string for transmission over HTTP JSON payloads.
 *
 * @param {Uint8Array} bytes Uint8Array to encode
 * @returns {string} Standard Base64 string
 */
function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/**
 * Helper to decode a standard Base64 string into a Uint8Array.
 *
 * @param {string} s Standard Base64 string
 * @returns {Uint8Array} Decoded byte array
 */
function base64ToBytes(s) {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(s, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  let padded = s;
  while (padded.length % 4 !== 0) {
    padded += '=';
  }
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/**
 * Factory creating a login flow function with injectable dependencies.
 *
 * @param {Object} [deps={}] Dependency overrides
 * @param {Object} [deps.oprf] OPRF library module
 * @param {Object} [deps.opaque] OPAQUE wrapper module
 * @param {Object} [deps.api] API client instance
 * @param {Object} [deps.session] Session storage module
 * @returns {(params: { username: string, password: string }) => Promise<{ sessionToken: string }>} Login flow execution function
 */
export function createLoginFlow(deps = {}) {
  return async function loginFlow({ username, password }) {
    if (typeof username !== 'string' || !username.trim()) {
      throw new LoginError('invalid_username', 'Username must be a non-empty string.');
    }
    if (typeof password !== 'string' || !password) {
      throw new LoginError('invalid_password', 'Password must be a non-empty string.');
    }

    const oprfMod = deps.oprf ?? (await import('../oprf/index.js'));
    const opaqueMod = deps.opaque ?? (await import('./opaque.js'));
    const apiMod = deps.api ?? (await import('../api/client.js')).api;
    const sessionMod = deps.session ?? (await import('./session.js'));

    let token;
    let tokenStr;
    try {
      const blindResult = await oprfMod.blind(username);
      const blindedBytes = blindResult.blindedBytes ?? blindResult;

      const { evaluated } = await apiMod.post('/oprf/blind', {
        body: { blinded: bytesToBase64(blindedBytes) }
      });

      const evaluatedBytes = typeof evaluated === 'string' ? base64ToBytes(evaluated) : evaluated;
      token = await oprfMod.finalize(username, evaluatedBytes, blindResult.state);
      tokenStr = bytesToBase64url(token);
    } catch (err) {
      if (err instanceof LoginError) throw err;
      if (err instanceof ApiError) throw err;
      if (err instanceof TypeError) {
        throw new LoginError('network', err.message || 'Network request failed.');
      }
      throw new LoginError('unknown', err.message || 'OPRF evaluation failed.');
    }

    let clientLoginState;
    let startLoginRequest;
    try {
      const startRes = await opaqueMod.startLogin({ password });
      clientLoginState = startRes.clientLoginState;
      startLoginRequest = startRes.startLoginRequest;
    } catch (err) {
      throw new LoginError('unknown', err.message || 'OPAQUE login start failed.');
    }

    let credentialResponse;
    try {
      const startApiRes = await apiMod.post('/auth/login/start', {
        body: {
          username_token: tokenStr,
          opaque_client_auth_state: startLoginRequest
        }
      });
      credentialResponse = startApiRes.credential_response;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof TypeError) {
        throw new LoginError('network', err.message || 'Network request failed.');
      }
      throw new LoginError('unknown', err.message || 'Login start request failed.');
    }

    let finishResult;
    try {
      finishResult = await opaqueMod.finishLogin({
        clientLoginState,
        loginResponse: credentialResponse,
        password
      });
    } catch (err) {
      throw new LoginError('unknown', err.message || 'OPAQUE login finish calculation failed.');
    }

    if (finishResult === null) {
      throw new LoginError('invalid_credentials', 'Incorrect username or password.');
    }

    let sessionToken;
    try {
      const finishApiRes = await apiMod.post('/auth/login/finish', {
        body: {
          username_token: tokenStr,
          ke3: finishResult.finishLoginRequest
        }
      });
      sessionToken = finishApiRes.session_token;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof TypeError) {
        throw new LoginError('network', err.message || 'Network request failed.');
      }
      throw new LoginError('unknown', err.message || 'Login finish request failed.');
    }

    sessionMod.setSessionToken(sessionToken);
    sessionMod.setOprfToken(token);
    sessionMod.setUsername(username);

    return { sessionToken };
  };
}

/**
 * Default singleton login flow function using standard lazy-loaded module dependencies.
 */
export const loginFlow = createLoginFlow();
