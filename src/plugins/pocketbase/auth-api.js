/**
 * @import PocketBase, { RecordAuthResponse, RecordModel, OTPResponse } from 'pocketbase'
 */

/**
 * Creates the PocketBase Authentication Abstraction API.
 * Encapsulates authentication, session management, and user identity calls.
 *
 * @param {PocketBase} pb PocketBase SDK client instance.
 * @returns {Object} Authentication API helper methods.
 */
export function createAuthApi (pb) {
  return {
    /**
     * Authenticates a user with username and password.
     *
     * @param {string} identity Username.
     * @param {string} password Account password.
     * @returns {Promise<RecordAuthResponse>} Auth response containing token and record.
     */
    async login (identity, password) {
      return await pb.collection('users').authWithPassword(identity, password)
    },

    /**
     * Requests a one-time password (OTP) for 2-step verification.
     *
     * @param {string} identity User username.
     * @returns {Promise<OTPResponse>} OTP challenge response containing otpId.
     */
    async requestOTP (identity) {
      return await pb.collection('users').requestOTP(identity)
    },

    /**
     * Verifies an OTP challenge code.
     *
     * @param {string} otpId OTP challenge ID.
     * @param {string} code 6-digit verification code.
     * @returns {Promise<RecordAuthResponse>} Auth response containing token and record.
     */
    async verifyOTP (otpId, code) {
      return await pb.collection('users').authWithOTP(otpId, code)
    },

    /**
     * Sends custom POST request for password rotation.
     *
     * @param {string} newKeyBHash new password/Key_B.
     * @param {object} newWrappedVMK newly wrapped VMK.
     * @param {array} remainingWraps remaining recovery wraps.
     * @returns {Promise<object>} response JSON.
     */
    async rotatePassword (newKeyBHash, newWrappedVMK, remainingWraps) {
      return await pb.send('/api/custom/rotate_password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          newKeyBHash,
          newWrappedVMK,
          remainingWraps
        })
      })
    },

    /**
     * Sends custom POST request for account recovery rate-limiting check.
     *
     * @param {string} username Username or identity.
     * @returns {Promise<object>} response JSON.
     */
    async recoverAccount (username) {
      return await pb.send('/api/custom/recover_account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username
        })
      })
    },

    /**
     * Clears current authentication state and removes stored tokens.
     */
    logout () {
      pb.authStore.clear()
    },

    /**
     * Retrieves the currently authenticated user record.
     *
     * @returns {RecordModel|null} The authenticated user record or null.
     */
    getUser () {
      return pb.authStore.record || pb.authStore.model || null
    },

    /**
     * Retrieves the current authentication token string.
     *
     * @returns {string} The active JWT authentication token.
     */
    getToken () {
      return pb.authStore.token || ''
    },

    /**
     * Checks if the active authentication session is valid.
     *
     * @returns {boolean} True if the current token is valid.
     */
    isAuthenticated () {
      return Boolean(pb.authStore.isValid)
    },

    /**
     * Subscribes a callback to authentication state changes.
     *
     * @param {function(string, RecordModel|null): void} callback Function invoked on auth change.
     * @returns {function(): void} Unsubscribe function.
     */
    onAuthChange (callback) {
      return pb.authStore.onChange((token, record) => {
        callback(token, record)
      })
    }
  }
}
