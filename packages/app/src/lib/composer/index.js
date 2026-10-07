/**
 * Generates a local message identifier prefixed with 'local_'.
 *
 * @param {Crypto} crypto Global Crypto object (injected)
 * @returns {string} Unique local message identifier
 */
export function generateLocalMessageId(crypto) {
  if (crypto && typeof crypto.randomUUID === 'function') {
    return `local_${crypto.randomUUID()}`
  }
  const bytes = (crypto || globalThis.crypto).getRandomValues(new Uint8Array(16))
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return `local_${hex}`
}

/**
 * Builds a text message payload object if non-empty string.
 *
 * @param {string} text Input text
 * @returns {{ type: 'text', text: string } | null}
 */
export function buildTextPayload(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed === '') return null
  return { type: 'text', text }
}

/**
 * Encodes a payload object as JSON string.
 *
 * @param {object|null} payload Payload object
 * @returns {string} JSON string or empty string
 */
export function encodePayload(payload) {
  if (payload === null || payload === undefined) return ''
  return JSON.stringify(payload)
}

/**
 * Creates a marker byte array for the ciphertext column ('stub:' + json).
 *
 * @param {object|null} payload Payload object
 * @returns {Uint8Array} Byte array
 */
export function encodeCiphertextStub(payload) {
  const json = encodePayload(payload)
  const prefix = new TextEncoder().encode('stub:')
  const body = new TextEncoder().encode(json)
  const out = new Uint8Array(prefix.length + body.length)
  out.set(prefix, 0)
  out.set(body, prefix.length)
  return out
}

/**
 * Detects whether the current window environment uses fine pointer (desktop).
 *
 * @param {Window} win Global window object
 * @returns {boolean}
 */
export function isDesktopPointer(win) {
  if (!win || typeof win.matchMedia !== 'function') return false
  return win.matchMedia('(pointer: fine)').matches
}

/**
 * Computes the epoch and seq for the next local application message in a room.
 *
 * @param {Array<{ epoch: number, seq: number }>} messages Newest-first application messages array
 * @returns {{ epoch: number, seq: number }}
 */
export function computeNextSeq(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { epoch: 0, seq: 1 }
  }
  const newest = messages[0]
  return {
    epoch: newest.epoch ?? 0,
    seq: (newest.seq ?? 0) + 1
  }
}
