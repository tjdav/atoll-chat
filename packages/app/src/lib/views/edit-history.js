/**
 * Parses the decrypted payload of a message version and extracts its text representation.
 *
 * @param {string|null} decryptedPayload - Raw JSON decrypted payload string.
 * @param {function} [parsePayload] - Function to parse JSON payload.
 * @param {function} [summarizePayload] - Function to summarize payload into text/placeholder object.
 * @returns {string} Extracted text content or empty string if non-text/invalid.
 */
export function parseVersionText(decryptedPayload, parsePayload, summarizePayload) {
  if (!decryptedPayload || typeof decryptedPayload !== 'string') return ''
  if (typeof parsePayload !== 'function' || typeof summarizePayload !== 'function') return ''

  const parsed = parsePayload(decryptedPayload)
  if (!parsed) return ''

  const summary = summarizePayload(parsed)
  if (summary && summary.kind === 'text') {
    return summary.text ?? ''
  }

  return ''
}

/**
 * Builds an ordered array of display objects for edit history presentation (newest first).
 *
 * @param {Array<object>} versions - Array of message version database rows.
 * @param {object} [options] - Configuration and dependency options.
 * @param {number} [options.now=Date.now()] - Reference timestamp in milliseconds.
 * @param {function} [options.formatTime] - Function to format relative timestamp string.
 * @param {function} [options.parsePayload] - Helper to parse JSON payload.
 * @param {function} [options.summarizePayload] - Helper to summarize payload.
 * @returns {Array<{ editSequence: number, text: string, timestamp: number, relativeTime: string, isCurrent: boolean, isOriginal: boolean }>} History display objects.
 */
export function buildHistory(versions, { now = Date.now(), formatTime, parsePayload, summarizePayload } = {}) {
  if (!Array.isArray(versions) || versions.length === 0) return []

  const sorted = [...versions].sort((a, b) => a.edit_sequence - b.edit_sequence)

  const items = sorted.map((v) => ({
    editSequence: v.edit_sequence,
    text: parseVersionText(v.decrypted_payload, parsePayload, summarizePayload),
    timestamp: v.edited_at,
    relativeTime: typeof formatTime === 'function' ? formatTime(v.edited_at, now) : '',
    isCurrent: false,
    isOriginal: false
  }))

  items[0].isOriginal = true
  items[items.length - 1].isCurrent = true

  return items.reverse()
}
