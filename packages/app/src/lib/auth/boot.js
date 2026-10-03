import { ApiError } from '../api/index.js';

/**
 * Custom error class representing boot flow failure conditions.
 */
export class BootError extends Error {
  /**
   * @param {string} code Error code string
   * @param {string} message Descriptive error message
   */
  constructor(code, message) {
    super(message);
    this.name = 'BootError';
    this.code = code;
  }
}

/**
 * Creates a boot flow execution function with injectable dependencies.
 *
 * @param {Object} [deps={}] Dependency overrides
 * @param {Object} [deps.session] Session storage module
 * @param {Object} [deps.api] API client instance
 * @param {Object} [deps.oprf] OPRF library module
 * @param {Object} [deps.codec] Codec module
 * @param {Function} [deps.navigate] Navigation handler function
 * @returns {() => Promise<{ redirected: boolean, reason?: string, hasOprfToken?: boolean, user?: Object|null }>} Async boot flow function
 */
export function createBootFlow(deps = {}) {
  return async function bootFlow() {
    const sessionMod = deps.session ?? (await import('./session.js'));
    const apiMod = deps.api ?? (await import('../api/client.js')).api;
    const oprfMod = deps.oprf ?? (await import('../oprf/index.js'));
    const codecMod = deps.codec ?? (await import('../codec/index.js'));
    const navigate = deps.navigate ?? ((url) => {
      if (typeof window !== 'undefined') {
        window.location.href = url;
      }
    });

    const sessionToken = sessionMod.getSessionToken();
    if (!sessionToken) {
      navigate('/index.html');
      return { redirected: true, reason: 'no_session' };
    }

    const username = sessionMod.getUsername();
    if (!username) {
      sessionMod.clearSession();
      navigate('/index.html');
      return { redirected: true, reason: 'no_username' };
    }

    let user = null;
    try {
      user = await apiMod.get('/users/me');
    } catch (err) {
      if (err instanceof ApiError || err?.name === 'ApiError') {
        if (err.status === 401) {
          sessionMod.clearSession();
          navigate('/index.html');
          return { redirected: true, reason: 'session_expired' };
        }
        if (err.status === 403) {
          sessionMod.clearSession();
          navigate('/index.html');
          return { redirected: true, reason: 'account_disabled' };
        }
      }
      user = null;
    }

    let hasOprfToken = false;
    try {
      const blindResult = await oprfMod.blind(username);
      const blindedBytes = blindResult.blindedBytes ?? blindResult;
      const { evaluated } = await apiMod.post('/oprf/blind', {
        body: { blinded: codecMod.bytesToBase64(blindedBytes) }
      });
      const evaluatedBytes = typeof evaluated === 'string' ? codecMod.base64ToBytes(evaluated) : evaluated;
      const tokenBytes = await oprfMod.finalize(username, evaluatedBytes, blindResult.state);
      sessionMod.setOprfToken(tokenBytes);
      hasOprfToken = true;
    } catch (err) {
      hasOprfToken = false;
    }

    return {
      redirected: false,
      hasOprfToken,
      user
    };
  };
}

/**
 * Default singleton boot flow function using standard lazy-loaded module dependencies.
 */
export const bootFlow = createBootFlow();
