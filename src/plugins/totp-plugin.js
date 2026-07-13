import { definePlugin } from 'coralite'

/**
 * TOTP Plugin for Atoll Chat
 * Exposes otplib for dynamic TOTP generation and verification.
 */
export default definePlugin({
  name: 'totp',
  client: {
    context: () => {
      return async () => {
        const otplib = await import('otplib')

        const $totp = {
          /**
           * Verifies a TOTP token against a base32 secret.
           * @param {string} token - The 6-digit verification code.
           * @param {string} secret - The Base32 encoded secret.
           * @returns {Promise<boolean>} True if the token is valid, false otherwise.
           */
          verify: async (token, secret) => {
            if (!token || !secret) {
              return false
            }
            try {
              const res = await otplib.verify({
                token,
                secret,
                crypto: new otplib.NobleCryptoPlugin(),
                base32: new otplib.ScureBase32Plugin()
              })
              return !!res?.valid
            } catch (err) {
              console.error('TOTP verification error:', err)
              return false
            }
          },

          /**
           * Generates a secure, random Base32 encoded TOTP secret.
           * Uses 20 bytes (32 characters) for compliance with modern standards.
           * @returns {string} The Base32 encoded secret string.
           */
          generateSecret: () => {
            return otplib.generateSecret({ length: 20 })
          }
        }

        return {
          $totp
        }
      }
    }
  }
})
