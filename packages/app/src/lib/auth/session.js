const SESSION_TOKEN_KEY = 'atoll.session.token';
const USERNAME_KEY = 'atoll.session.username';

let oprfTokenStore = null;

const inMemoryStorage = new Map();

/**
 * Helper to safely read from localStorage or in-memory fallback if localStorage is unavailable.
 *
 * @param {string} key Storage key
 * @returns {string|null} Stored string value or null
 */
function getStorageItem(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch (err) {
    // localStorage disabled or unavailable
  }
  return inMemoryStorage.get(key) ?? null;
}

/**
 * Helper to safely write to localStorage or in-memory fallback if localStorage is unavailable.
 *
 * @param {string} key Storage key
 * @param {string} value String value to store
 */
function setStorageItem(key, value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch (err) {
    // localStorage disabled or unavailable
  }
  inMemoryStorage.set(key, value);
}

/**
 * Helper to safely remove an item from localStorage and in-memory fallback.
 *
 * @param {string} key Storage key
 */
function removeStorageItem(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch (err) {
    // localStorage disabled or unavailable
  }
  inMemoryStorage.delete(key);
}

/**
 * Stores the authenticated session token in persistent storage.
 *
 * @param {string} token Session token string
 */
export function setSessionToken(token) {
  if (typeof token !== 'string') {
    throw new TypeError('token must be a string');
  }
  setStorageItem(SESSION_TOKEN_KEY, token);
}

/**
 * Retrieves the stored session token.
 *
 * @returns {string|null} Stored session token or null
 */
export function getSessionToken() {
  return getStorageItem(SESSION_TOKEN_KEY);
}

/**
 * Clears the stored session token.
 */
export function clearSessionToken() {
  removeStorageItem(SESSION_TOKEN_KEY);
}

/**
 * Stores the session-scoped OPRF token in ephemeral memory. Never persisted to disk.
 *
 * @param {Uint8Array} bytes OPRF token bytes
 */
export function setOprfToken(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('bytes must be a Uint8Array');
  }
  oprfTokenStore = new Uint8Array(bytes);
}

/**
 * Retrieves the session-scoped OPRF token from ephemeral memory.
 *
 * @returns {Uint8Array|null} OPRF token bytes or null
 */
export function getOprfToken() {
  if (!oprfTokenStore) {
    return null;
  }
  return new Uint8Array(oprfTokenStore);
}

/**
 * Clears the session-scoped OPRF token from ephemeral memory.
 */
export function clearOprfToken() {
  oprfTokenStore = null;
}

/**
 * Stores the authenticated username in persistent storage.
 *
 * @param {string} username Username handle
 */
export function setUsername(username) {
  if (typeof username !== 'string') {
    throw new TypeError('username must be a string');
  }
  setStorageItem(USERNAME_KEY, username);
}

/**
 * Retrieves the stored username handle.
 *
 * @returns {string|null} Stored username handle or null
 */
export function getUsername() {
  return getStorageItem(USERNAME_KEY);
}

/**
 * Clears the stored username handle.
 */
export function clearUsername() {
  removeStorageItem(USERNAME_KEY);
}

/**
 * Clears all session state including persistent session token, username, and ephemeral OPRF token.
 */
export function clearSession() {
  clearSessionToken();
  clearOprfToken();
  clearUsername();
}
