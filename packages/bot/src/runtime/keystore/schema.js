/**
 * Helper to check if a value is a plain non-null object.
 *
 * @param {unknown} value - The value to check.
 * @returns {value is Record<string, unknown>} True if value is an object.
 */
function isObject (value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validates a base64url encoded string and checks decoded byte length.
 *
 * @param {unknown} str - The string to check.
 * @param {number} expectedLength - Exact expected byte length, or min byte length if minLength is true.
 * @param {boolean} [minLength=false] - Whether expectedLength is a minimum requirement.
 * @returns {boolean} True if string is valid base64url decoding to expected length.
 */
function isValidBase64url (str, expectedLength, minLength = false) {
  if (typeof str !== 'string' || str.length === 0) {
    return false
  }
  if (!/^[A-Za-z0-9_-]+$/.test(str)) {
    return false
  }
  try {
    const buf = Buffer.from(str, 'base64url')
    if (minLength) {
      return buf.byteLength >= expectedLength
    }
    return buf.byteLength === expectedLength
  } catch {
    return false
  }
}

/**
 * Helper to check ISO 8601 date string.
 *
 * @param {unknown} str - The string to check.
 * @returns {boolean} True if str is a valid ISO 8601 date string.
 */
function isIso8601 (str) {
  if (typeof str !== 'string' || str.trim().length === 0) {
    return false
  }
  const date = new Date(str)
  return !Number.isNaN(date.getTime())
}

/**
 * Validates a parsed outer file structure.
 *
 * @param {unknown} value - The parsed JSON to validate.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateOuter (value) {
  if (!isObject(value)) {
    return {
      ok: false,
      reason: 'Outer content must be a JSON object'
    }
  }

  if (value.version !== 1) {
    return {
      ok: false,
      reason: 'outer version must equal 1'
    }
  }

  if (typeof value.bot_id !== 'string' || value.bot_id.trim() === '') {
    return {
      ok: false,
      reason: 'outer bot_id must be a non-empty string'
    }
  }

  if (!isValidBase64url(value.salt, 16)) {
    return {
      ok: false,
      reason: 'outer salt must be a 16-byte base64url string'
    }
  }

  if (!isValidBase64url(value.nonce, 12)) {
    return {
      ok: false,
      reason: 'outer nonce must be a 12-byte base64url string'
    }
  }

  if (!isValidBase64url(value.ct, 16, true)) {
    return {
      ok: false,
      reason: 'outer ct must be a base64url string of at least 16 bytes'
    }
  }

  return { ok: true }
}

/**
 * Validates a parsed plaintext structure.
 *
 * @param {unknown} value - The parsed JSON to validate.
 * @param {string} outerBotId - The bot_id from the outer structure, for
 *   the cross-check.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validatePlaintext (value, outerBotId) {
  if (!isObject(value)) {
    return {
      ok: false,
      reason: 'Plaintext content must be a JSON object'
    }
  }

  if (value.version !== 1) {
    return {
      ok: false,
      reason: 'plaintext version must equal 1'
    }
  }

  if (typeof value.bot_id !== 'string' || value.bot_id.trim() === '') {
    return {
      ok: false,
      reason: 'plaintext bot_id must be a non-empty string'
    }
  }

  if (value.bot_id !== outerBotId) {
    return {
      ok: false,
      reason: `plaintext bot_id (${String(value.bot_id)}) does not match outer bot_id (${outerBotId})`
    }
  }

  if (typeof value.bot_token !== 'string' || value.bot_token.trim() === '') {
    return {
      ok: false,
      reason: 'plaintext bot_token must be a non-empty string'
    }
  }

  if (!isValidBase64url(value.bot_identity_private, 32)) {
    return {
      ok: false,
      reason: 'plaintext bot_identity_private must be a 32-byte base64url string'
    }
  }

  if (!isValidBase64url(value.bot_command_private, 32)) {
    return {
      ok: false,
      reason: 'plaintext bot_command_private must be a 32-byte base64url string'
    }
  }

  if (!isValidBase64url(value.identity_private, 32)) {
    return {
      ok: false,
      reason: 'plaintext identity_private must be a 32-byte base64url string'
    }
  }

  if (!isValidBase64url(value.storage_seed, 32)) {
    return {
      ok: false,
      reason: 'plaintext storage_seed must be a 32-byte base64url string'
    }
  }

  if (value.operator_session !== undefined && typeof value.operator_session !== 'string') {
    return {
      ok: false,
      reason: 'plaintext operator_session must be a string or undefined'
    }
  }

  if (!isIso8601(value.created_at)) {
    return {
      ok: false,
      reason: 'plaintext created_at must be an ISO 8601 date string'
    }
  }

  if (!isIso8601(value.rotated_at)) {
    return {
      ok: false,
      reason: 'plaintext rotated_at must be an ISO 8601 date string'
    }
  }

  return { ok: true }
}
