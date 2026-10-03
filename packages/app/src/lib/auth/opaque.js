import * as opaque from '@serenity-kit/opaque';
import { base64ToBase64url } from '../codec/index.js';

/**
 * Initializes the client side of an OPAQUE login flow.
 *
 * @param {Object} params
 * @param {string} params.password Plaintext user password
 * @returns {Promise<{ clientLoginState: string, startLoginRequest: string }>} OPAQUE client login state handle and start login request payload (base64url)
 */
export async function startLogin({ password }) {
  if (typeof password !== 'string') {
    throw new TypeError('password must be a string');
  }
  if (opaque.ready) {
    await opaque.ready;
  }
  return opaque.client.startLogin({ password });
}

/**
 * Finalizes the client side of an OPAQUE login flow using the server's credential response.
 * Converts standard Base64 server responses to unpadded Base64URL prior to invoking the underlying client library.
 *
 * @param {Object} params
 * @param {string} params.clientLoginState OPAQUE client login state handle returned by startLogin
 * @param {string} params.loginResponse Standard Base64 encoded credential response from server
 * @param {string} params.password Plaintext user password
 * @returns {Promise<{ finishLoginRequest: string, sessionKey: string } | null>} OPAQUE finish login request payload and derived session key (base64url), or null on authentication failure
 */
export async function finishLogin({ clientLoginState, loginResponse, password }) {
  if (typeof clientLoginState !== 'string') {
    throw new TypeError('clientLoginState must be a string');
  }
  if (typeof loginResponse !== 'string') {
    throw new TypeError('loginResponse must be a string');
  }
  if (typeof password !== 'string') {
    throw new TypeError('password must be a string');
  }
  if (opaque.ready) {
    await opaque.ready;
  }

  const loginResponseUrl = base64ToBase64url(loginResponse);

  try {
    const result = await opaque.client.finishLogin({
      clientLoginState,
      loginResponse: loginResponseUrl,
      password,
    });
    if (!result) {
      return null;
    }
    return result;
  } catch (err) {
    return null;
  }
}

/**
 * Initializes the client side of an OPAQUE registration flow.
 *
 * @param {Object} params
 * @param {string} params.password Plaintext user password
 * @returns {Promise<{ clientRegistrationState: string, registrationRequest: string }>} OPAQUE client registration state handle and registration request payload (base64url)
 */
export async function startRegistration({ password }) {
  if (typeof password !== 'string') {
    throw new TypeError('password must be a string');
  }
  if (opaque.ready) {
    await opaque.ready;
  }
  return opaque.client.startRegistration({ password });
}

/**
 * Finalizes the client side of an OPAQUE registration flow using the server's registration response.
 * Converts standard Base64 server responses to unpadded Base64URL prior to invoking the underlying client library.
 *
 * @param {Object} params
 * @param {string} params.clientRegistrationState OPAQUE client registration state handle returned by startRegistration
 * @param {string} params.registrationResponse Standard Base64 encoded registration response from server
 * @param {string} params.password Plaintext user password
 * @returns {Promise<{ registrationRecord: string }>} OPAQUE registration record payload (base64url)
 */
export async function finishRegistration({ clientRegistrationState, registrationResponse, password }) {
  if (typeof clientRegistrationState !== 'string') {
    throw new TypeError('clientRegistrationState must be a string');
  }
  if (typeof registrationResponse !== 'string') {
    throw new TypeError('registrationResponse must be a string');
  }
  if (typeof password !== 'string') {
    throw new TypeError('password must be a string');
  }
  if (opaque.ready) {
    await opaque.ready;
  }

  const registrationResponseUrl = base64ToBase64url(registrationResponse);

  let result;
  try {
    result = await opaque.client.finishRegistration({
      clientRegistrationState,
      registrationResponse: registrationResponseUrl,
      password,
    });
  } catch (err) {
    throw new Error('OPAQUE registration failed.');
  }

  if (!result || !result.registrationRecord) {
    throw new Error('OPAQUE registration failed.');
  }

  return result;
}
