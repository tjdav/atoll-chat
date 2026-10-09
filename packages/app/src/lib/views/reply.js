/**
 * Pure helpers and reply context orchestration for message quoting and replies.
 */

/**
 * Truncates text to a maximum length with word boundary awareness and appends an ellipsis.
 *
 * @param {string | null | undefined} text Input text string to truncate.
 * @param {object} [options] Truncation options.
 * @param {number} [options.maxLength=120] Maximum character limit before truncation.
 * @returns {string} Truncated string with trailing ellipsis if exceeded, or empty string.
 */
export function truncateQuote(text, { maxLength = 120 } = {}) {
  if (text === null || text === undefined) {
    return ''
  }
  const str = String(text)
  if (str.length <= maxLength) {
    return str
  }

  let cutIndex = maxLength
  const charAtCut = str[maxLength]
  const charBeforeCut = str[maxLength - 1]

  if (charAtCut && !/\s/.test(charAtCut) && charBeforeCut && !/\s/.test(charBeforeCut)) {
    const lastSpace = str.slice(0, maxLength).search(/\s\S*$/)
    if (lastSpace > 0) {
      cutIndex = lastSpace
    }
  }

  return str.slice(0, cutIndex).trimEnd() + '…'
}

/**
 * Builds context metadata for replying to a parent message.
 *
 * @param {object} options Context options container.
 * @param {object} options.repos Repository aggregator containing messages repository.
 * @param {string} options.parentMessageId Identifier of parent message being replied to.
 * @param {Function} options.summarizePayload Pure payload summarizer.
 * @param {Function} options.parsePayload Pure payload JSON parser.
 * @returns {Promise<{ messageId: string, senderUserId: string, senderName: string, snippet: string, isDeleted: boolean } | null>}
 */
export async function buildReplyContext({ repos, parentMessageId, summarizePayload, parsePayload }) {
  if (!repos || !parentMessageId) {
    return null
  }

  const parentMessage = await repos.messages.get(parentMessageId)
  if (!parentMessage) {
    return null
  }

  const payload = parsePayload ? parsePayload(parentMessage.decrypted_payload) : null
  const summary = summarizePayload ? summarizePayload(payload) : { kind: 'unknown' }

  let snippet = ''
  if (summary.kind === 'text') {
    snippet = truncateQuote(summary.text)
  } else if (summary.key) {
    snippet = '[' + summary.key + ']'
  }

  return {
    messageId: parentMessageId,
    senderUserId: parentMessage.sender_user_id,
    senderName: '',
    snippet,
    isDeleted: Boolean(parentMessage.deleted_at)
  }
}

/**
 * Evaluates whether replying to the specified message is permitted.
 *
 * @param {object | null | undefined} message Message record or null.
 * @returns {boolean} True if message is non-null/defined.
 */
export function isReplyAllowed(message) {
  return message !== null && message !== undefined
}

/**
 * Formats a reply preview display label from sender name and quoted snippet.
 *
 * @param {object} options
 * @param {string} [options.senderName=''] Display name of quoted sender.
 * @param {string} [options.snippet=''] Quoted text snippet.
 * @returns {string} Formatted label string.
 */
export function formatReplyPreviewLabel({ senderName = '', snippet = '' } = {}) {
  if (!senderName) {
    return ''
  }
  if (!snippet) {
    return senderName
  }
  return `${senderName}: ${snippet}`
}
