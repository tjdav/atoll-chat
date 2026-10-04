import { ApiError } from '../api/index.js';
import { bytesToBase64, base64ToBytes, bytesToBase64url, base64urlToBytes } from '../codec/index.js';

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
 * Error thrown during recovery flow execution.
 */
export class RecoverError extends Error {
  /**
   * @param {string} code Error code string (e.g. "recovery_invalid", "rate_limited", "recovery_expired", "opaque_failed", "display_name_invalid", "network", "unknown")
   * @param {string} message Descriptive error message
   */
  constructor(code, message) {
    super(message);
    this.name = 'RecoverError';
    this.code = code;
  }
}

/**
 * Error thrown during registration flow execution.
 */
export class RegisterError extends Error {
  /**
   * @param {string} code Error code string (e.g. "invite_invalid", "altcha_failed", "username_taken", "opaque_failed", "display_name_invalid", "network", "unknown")
   * @param {string} message Descriptive error message
   */
  constructor(code, message) {
    super(message);
    this.name = 'RegisterError';
    this.code = code;
  }
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

/**
 * Factory creating a registration flow function with injectable dependencies.
 *
 * Registration flow executes OPRF blinding/finalization, display name encryption,
 * OPAQUE registration, and Ed25519 identity keypair generation.
 *
 * Does NOT persist session token, OPRF token, username, or identity keypair.
 * The caller (e.g. registration UI) persists credentials only after recovery code confirmation succeeds.
 *
 * @param {Object} [deps={}] Dependency overrides
 * @param {Object} [deps.oprf] OPRF library module
 * @param {Object} [deps.opaque] OPAQUE wrapper module
 * @param {Object} [deps.crypto] Display name crypto module
 * @param {Object} [deps.identity] Identity keypair module
 * @param {Object} [deps.api] API client instance
 * @param {Object} [deps.codec] Codec module
 * @returns {(params: { inviteCode?: string, altcha?: string, username: string, displayName: string, password: string }) => Promise<{ sessionToken: string, userId: string, recoveryCodes: string[], identityPrivateKey: Uint8Array, identityPublicKey: Uint8Array, oprfToken: Uint8Array, username: string }>} Registration flow execution function
 */
export function createRegisterFlow(deps = {}) {
  return async function registerFlow({ inviteCode, altcha, username, displayName, password }) {
    const d = {
      oprf: deps.oprf ?? (await import('../oprf/index.js')),
      opaque: deps.opaque ?? (await import('./opaque.js')),
      crypto: deps.crypto ?? (await import('../crypto/display-name.js')),
      identity: deps.identity ?? (await import('./identity.js')),
      api: deps.api ?? (await import('../api/client.js')).api,
      codec: deps.codec ?? (await import('../codec/index.js')),
    };

    let blindResult;
    let blindedBytes;
    let blindedStr;
    try {
      blindResult = await d.oprf.blind(username);
      blindedBytes = blindResult.blindedBytes ?? blindResult;
      blindedStr = d.codec.bytesToBase64 ? d.codec.bytesToBase64(blindedBytes) : bytesToBase64(blindedBytes);
    } catch (err) {
      if (err instanceof RegisterError) throw err;
      throw new RegisterError('unknown', err.message || 'OPRF blinding failed.');
    }

    let evaluatedStr;
    try {
      const { evaluated } = await d.api.post('/oprf/blind', {
        body: { blinded: blindedStr }
      });
      evaluatedStr = evaluated;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status >= 500) {
          const regErr = new RegisterError('network', 'The server had a problem. Try again.');
          regErr.cause = err;
          throw regErr;
        }
      }
      if (err instanceof TypeError) {
        const regErr = new RegisterError('network', err.message || 'Network request failed.');
        regErr.cause = err;
        throw regErr;
      }
      const regErr = new RegisterError('unknown', err.message || 'OPRF request failed.');
      regErr.cause = err;
      throw regErr;
    }

    let tokenBytes;
    let tokenStr;
    try {
      const decodeB64 = d.codec.base64ToBytes ? d.codec.base64ToBytes : base64ToBytes;
      const evaluatedBytes = typeof evaluatedStr === 'string' ? decodeB64(evaluatedStr) : evaluatedStr;
      tokenBytes = await d.oprf.finalize(username, evaluatedBytes, blindResult.state);
      tokenStr = d.codec.bytesToBase64url(tokenBytes);
    } catch (err) {
      if (err instanceof RegisterError) throw err;
      throw new RegisterError('unknown', err.message || 'OPRF finalization failed.');
    }

    let encryptedDisplayStr;
    try {
      const displayNameKey = await d.oprf.deriveDisplayNameKey(tokenBytes);
      const encryptedBytes = await d.crypto.encryptDisplayName(displayName, displayNameKey);
      encryptedDisplayStr = d.codec.bytesToBase64url(encryptedBytes);
    } catch (err) {
      throw new RegisterError('display_name_invalid', err.message || 'Invalid display name.');
    }

    let clientRegistrationState;
    let registrationRequest;
    try {
      const startRes = await d.opaque.startRegistration({ password });
      clientRegistrationState = startRes.clientRegistrationState;
      registrationRequest = startRes.registrationRequest;
    } catch (err) {
      throw new RegisterError('opaque_failed', err.message || 'OPAQUE registration start failed.');
    }

    let registration_response;
    try {
      const startApiRes = await d.api.post('/auth/register/start', {
        body: {
          username_token: tokenStr,
          opaque_client_registration_state: registrationRequest,
          altcha
        }
      });
      registration_response = startApiRes.registration_response;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status >= 500) {
          const regErr = new RegisterError('network', 'The server had a problem. Try again.');
          regErr.cause = err;
          throw regErr;
        }
        if (err.status === 400 && err.code === 'invite_invalid') {
          const regErr = new RegisterError('invite_invalid', 'That invite code is not valid or has expired.');
          regErr.cause = err;
          throw regErr;
        }
        if (err.status === 400 && err.code === 'altcha_failed') {
          const regErr = new RegisterError('altcha_failed', 'Verification failed. Try again.');
          regErr.cause = err;
          throw regErr;
        }
        if (err.status === 409) {
          const regErr = new RegisterError('username_taken', 'That username is already in use.');
          regErr.cause = err;
          throw regErr;
        }
        const regErr = new RegisterError('unknown', err.message || 'Registration start failed.');
        regErr.cause = err;
        throw regErr;
      }
      if (err instanceof TypeError) {
        const regErr = new RegisterError('network', err.message || 'Network request failed.');
        regErr.cause = err;
        throw regErr;
      }
      const regErr = new RegisterError('unknown', err.message || 'Registration start failed.');
      regErr.cause = err;
      throw regErr;
    }

    let finished;
    try {
      finished = await d.opaque.finishRegistration({
        clientRegistrationState,
        registrationResponse: registration_response,
        password
      });
    } catch (err) {
      throw new RegisterError('opaque_failed', 'Registration failed. Try again.');
    }

    let identity;
    let identityPublicB64;
    try {
      identity = await d.identity.generateIdentityKeypair();
      identityPublicB64 = d.codec.bytesToBase64url(identity.publicKey);
    } catch (err) {
      throw new RegisterError('unknown', err.message || 'Identity keypair generation failed.');
    }

    let response;
    try {
      response = await d.api.post('/auth/register/finish', {
        body: {
          username_token: tokenStr,
          encrypted_display: encryptedDisplayStr,
          opaque_record: finished.registrationRecord,
          identity_pubkey: identityPublicB64
        }
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status >= 500) {
          const regErr = new RegisterError('network', 'The server had a problem. Try again.');
          regErr.cause = err;
          throw regErr;
        }
        const regErr = new RegisterError('unknown', err.message || 'Registration finish failed.');
        regErr.cause = err;
        throw regErr;
      }
      if (err instanceof TypeError) {
        const regErr = new RegisterError('network', err.message || 'Network request failed.');
        regErr.cause = err;
        throw regErr;
      }
      const regErr = new RegisterError('unknown', err.message || 'Registration finish failed.');
      regErr.cause = err;
      throw regErr;
    }

    return {
      sessionToken: response.session_token,
      userId: response.user_id,
      recoveryCodes: response.recovery_codes,
      identityPrivateKey: identity.privateKey,
      identityPublicKey: identity.publicKey,
      oprfToken: tokenBytes,
      username
    };
  };
}

/**
 * Default singleton registration flow function using standard lazy-loaded module dependencies.
 */
export const registerFlow = createRegisterFlow();

/**
 * Factory creating a recovery flow function with injectable dependencies.
 *
 * Recovery flow executes OPRF blinding/finalization, display name encryption,
 * recovery start request, local OPAQUE registration, identity keypair regeneration,
 * and recovery finish request.
 *
 * Does NOT persist session credentials or identity keys internally.
 *
 * @param {Object} [deps={}] Dependency overrides
 * @param {Object} [deps.oprf] OPRF library module
 * @param {Object} [deps.opaque] OPAQUE wrapper module
 * @param {Object} [deps.crypto] Display name crypto module
 * @param {Object} [deps.identity] Identity keypair module
 * @param {Object} [deps.api] API client instance
 * @param {Object} [deps.codec] Codec module
 * @returns {(params: { username: string, recoveryCode: string, displayName: string, newPassword: string }) => Promise<{ sessionToken: string, userId: string, identityPrivateKey: Uint8Array, identityPublicKey: Uint8Array, oprfToken: Uint8Array, username: string }>} Recovery flow execution function
 */
export function createRecoverFlow(deps = {}) {
  return async function recoverFlow({ username, recoveryCode, displayName, newPassword }) {
    const d = {
      oprf: deps.oprf ?? (await import('../oprf/index.js')),
      opaque: deps.opaque ?? (await import('./opaque.js')),
      crypto: deps.crypto ?? (await import('../crypto/display-name.js')),
      identity: deps.identity ?? (await import('./identity.js')),
      api: deps.api ?? (await import('../api/client.js')).api,
      codec: deps.codec ?? (await import('../codec/index.js')),
    };

    let blindResult;
    let blindedBytes;
    let blindedStr;
    try {
      blindResult = await d.oprf.blind(username);
      blindedBytes = blindResult.blindedBytes ?? blindResult;
      blindedStr = d.codec.bytesToBase64 ? d.codec.bytesToBase64(blindedBytes) : bytesToBase64(blindedBytes);
    } catch (err) {
      if (err instanceof RecoverError) throw err;
      throw new RecoverError('unknown', err.message || 'OPRF blinding failed.');
    }

    let evaluatedStr;
    try {
      const { evaluated } = await d.api.post('/oprf/blind', {
        body: { blinded: blindedStr }
      });
      evaluatedStr = evaluated;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status >= 500) {
          const recErr = new RecoverError('network', 'The server had a problem. Try again.');
          recErr.cause = err;
          throw recErr;
        }
      }
      if (err instanceof TypeError) {
        const recErr = new RecoverError('network', err.message || 'Network request failed.');
        recErr.cause = err;
        throw recErr;
      }
      const recErr = new RecoverError('unknown', err.message || 'OPRF request failed.');
      recErr.cause = err;
      throw recErr;
    }

    let tokenBytes;
    let tokenStr;
    try {
      const decodeB64 = d.codec.base64ToBytes ? d.codec.base64ToBytes : base64ToBytes;
      const evaluatedBytes = typeof evaluatedStr === 'string' ? decodeB64(evaluatedStr) : evaluatedStr;
      tokenBytes = await d.oprf.finalize(username, evaluatedBytes, blindResult.state);
      tokenStr = d.codec.bytesToBase64url(tokenBytes);
    } catch (err) {
      if (err instanceof RecoverError) throw err;
      throw new RecoverError('unknown', err.message || 'OPRF finalization failed.');
    }

    let encryptedDisplayStr;
    try {
      const displayNameKey = await d.oprf.deriveDisplayNameKey(tokenBytes);
      const encryptedBytes = await d.crypto.encryptDisplayName(displayName, displayNameKey);
      encryptedDisplayStr = d.codec.bytesToBase64url(encryptedBytes);
    } catch (err) {
      throw new RecoverError('display_name_invalid', err.message || 'Invalid display name.');
    }

    let startResponse;
    try {
      startResponse = await d.api.post('/auth/recover/start', {
        body: { recovery_code: recoveryCode, username_token: tokenStr }
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          const recErr = new RecoverError('recovery_invalid', 'That recovery code does not match this account.');
          recErr.cause = err;
          throw recErr;
        }
        if (err.status === 429) {
          const recErr = new RecoverError('rate_limited', 'Too many attempts. Try again in a moment.');
          recErr.cause = err;
          throw recErr;
        }
        if (err.status >= 500) {
          const recErr = new RecoverError('network', 'The server had a problem. Try again.');
          recErr.cause = err;
          throw recErr;
        }
        const recErr = new RecoverError('unknown', err.message || 'Recovery start failed.');
        recErr.cause = err;
        throw recErr;
      }
      if (err instanceof TypeError) {
        const recErr = new RecoverError('network', err.message || 'Network request failed.');
        recErr.cause = err;
        throw recErr;
      }
      const recErr = new RecoverError('unknown', err.message || 'Recovery start failed.');
      recErr.cause = err;
      throw recErr;
    }

    let clientRegistrationState;
    let _registrationRequest;
    try {
      const startRes = await d.opaque.startRegistration({ password: newPassword });
      clientRegistrationState = startRes.clientRegistrationState;
      _registrationRequest = startRes.registrationRequest;
    } catch (err) {
      throw new RecoverError('opaque_failed', err.message || 'Recovery failed. Try again.');
    }

    let finished;
    try {
      finished = await d.opaque.finishRegistration({
        clientRegistrationState,
        registrationResponse: startResponse.registration_response,
        password: newPassword
      });
    } catch (err) {
      throw new RecoverError('opaque_failed', 'Recovery failed. Try again.');
    }
    if (!finished || !finished.registrationRecord) {
      throw new RecoverError('opaque_failed', 'Recovery failed. Try again.');
    }

    let identity;
    let identityPublicB64;
    try {
      identity = await d.identity.generateIdentityKeypair();
      identityPublicB64 = d.codec.bytesToBase64url(identity.publicKey);
    } catch (err) {
      throw new RecoverError('unknown', err.message || 'Identity keypair generation failed.');
    }

    let finishResponse;
    try {
      finishResponse = await d.api.post('/auth/recover/finish', {
        body: {
          username_token: tokenStr,
          recovery_session: startResponse.recovery_session,
          opaque_record: finished.registrationRecord,
          encrypted_display: encryptedDisplayStr,
          identity_pubkey: identityPublicB64
        }
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          const recErr = new RecoverError('recovery_expired', 'Your recovery session expired. Start again.');
          recErr.cause = err;
          throw recErr;
        }
        if (err.status >= 500) {
          const recErr = new RecoverError('network', 'The server had a problem. Try again.');
          recErr.cause = err;
          throw recErr;
        }
        const recErr = new RecoverError('unknown', err.message || 'Recovery finish failed.');
        recErr.cause = err;
        throw recErr;
      }
      if (err instanceof TypeError) {
        const recErr = new RecoverError('network', err.message || 'Network request failed.');
        recErr.cause = err;
        throw recErr;
      }
      const recErr = new RecoverError('unknown', err.message || 'Recovery finish failed.');
      recErr.cause = err;
      throw recErr;
    }

    return {
      sessionToken: finishResponse.session_token,
      userId: finishResponse.user_id,
      identityPrivateKey: identity.privateKey,
      identityPublicKey: identity.publicKey,
      oprfToken: tokenBytes,
      username
    };
  };
}

/**
 * Default singleton recovery flow function using standard lazy-loaded module dependencies.
 */
export const recoverFlow = createRecoverFlow();
