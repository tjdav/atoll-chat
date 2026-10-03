/**
 * In-memory staging module for the registration flow result.
 *
 * This module deliberately does not persist data to localStorage or sessionStorage.
 * If the user reloads the page before completing recovery code confirmation,
 * the pending registration in memory is lost. In that event, the server account
 * has already been created, so the user can log in directly with their password.
 * Storing a half-registered session token prior to confirmation would risk leaving
 * the client in an inconsistent state if confirmation is abandoned.
 */

/** @type {Object|null} */
let pendingRegistration = null

/**
 * Stores the registration result in memory.
 *
 * @param {Object} data The registration flow return payload.
 */
export function setPendingRegistration(data) {
  pendingRegistration = data
}

/**
 * Retrieves the staged registration result from memory.
 *
 * @returns {Object|null} The pending registration object or null.
 */
export function getPendingRegistration() {
  return pendingRegistration
}

/**
 * Clears the staged registration result from memory.
 */
export function clearPendingRegistration() {
  pendingRegistration = null
}

/**
 * Checks whether a registration result is currently staged in memory.
 *
 * @returns {boolean} True if pending registration exists, false otherwise.
 */
export function hasPendingRegistration() {
  return pendingRegistration !== null
}
