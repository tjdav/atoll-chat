/**
 * Safely parses a JSON string into an object or returns null on failure.
 *
 * @param {string|null} json - JSON string to parse.
 * @returns {object|null} Parsed object or null.
 */
export function safeParsePayload(json) {
  if (!json || typeof json !== 'string') return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/**
 * Summarizes a decoded message payload into a text or localized placeholder representation.
 *
 * @param {object|null} payload - Decoded message payload object.
 * @returns {{ kind: 'text', text: string } | { kind: 'placeholder', key: string }} Summarized payload description.
 */
export function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { kind: 'placeholder', key: 'chat_placeholder_unknown' }
  }

  switch (payload.type) {
    case 'text':
      return { kind: 'text', text: payload.text ?? '' }
    case 'image':
      return { kind: 'placeholder', key: 'chat_placeholder_photo' }
    case 'video':
      return { kind: 'placeholder', key: 'chat_placeholder_video' }
    case 'audio':
      return { kind: 'placeholder', key: 'chat_placeholder_voice' }
    case 'file':
      return { kind: 'placeholder', key: 'chat_placeholder_document' }
    case 'sticker':
      return { kind: 'placeholder', key: 'chat_placeholder_sticker' }
    default:
      return { kind: 'placeholder', key: 'chat_placeholder_unknown' }
  }
}

/**
 * Groups chronological message rows by sender and time window boundary.
 *
 * @param {Array<object>} messages - Chronological message rows (oldest first).
 * @param {object} [options] - Grouping configuration options.
 * @param {number} [options.windowMs=300000] - Maximum gap between grouped messages in milliseconds (default 5m).
 * @returns {Array<{ senderUserId: string, startIndex: number, endIndex: number, messages: Array<object> }>} Array of message groups.
 */
export function groupMessages(messages, { windowMs = 5 * 60 * 1000 } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return []

  const groups = []
  let currentGroup = null

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]
    const senderUserId = msg.sender_user_id

    if (!currentGroup) {
      currentGroup = {
        senderUserId,
        startIndex: i,
        endIndex: i,
        messages: [msg]
      }
      continue
    }

    const prevMsg = currentGroup.messages[currentGroup.messages.length - 1]
    const sameSender = msg.sender_user_id === prevMsg.sender_user_id
    const timeGap = (msg.created_at ?? 0) - (prevMsg.created_at ?? 0)

    if (sameSender && timeGap <= windowMs) {
      currentGroup.endIndex = i
      currentGroup.messages.push(msg)
    } else {
      groups.push(currentGroup)
      currentGroup = {
        senderUserId,
        startIndex: i,
        endIndex: i,
        messages: [msg]
      }
    }
  }

  if (currentGroup) {
    groups.push(currentGroup)
  }

  return groups
}

/**
 * Formats a timestamp into a date label ('Today', 'Yesterday', or formatted date string).
 *
 * @param {number} timestamp - Timestamp in milliseconds.
 * @param {number} [now=Date.now()] - Current reference timestamp in milliseconds.
 * @returns {string} Formatted date label string.
 */
export function formatDateLabel(timestamp, now = Date.now()) {
  const msgDate = new Date(timestamp)
  const nowDate = new Date(now)

  const msgDay = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate()).getTime()
  const nowDay = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()

  const dayMs = 24 * 60 * 60 * 1000
  const diffDays = Math.round((nowDay - msgDay) / dayMs)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'

  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(msgDate)
}

/**
 * Inserts date separators before message groups when calendar days change.
 *
 * @param {Array<object>} groups - Array of message groups.
 * @param {object} [options] - Options object.
 * @param {number} [options.now=Date.now()] - Current reference timestamp.
 * @returns {Array<{ kind: 'date', timestamp: number, label: string } | { kind: 'group', group: object }>} Items with inserted date separators.
 */
export function insertDateSeparators(groups, { now = Date.now() } = {}) {
  if (!Array.isArray(groups) || groups.length === 0) return []

  const result = []
  let previousDayString = null

  for (const group of groups) {
    const firstMsg = group.messages[0]
    const timestamp = firstMsg?.created_at ?? now
    const d = new Date(timestamp)
    const dayString = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

    if (previousDayString === null || dayString !== previousDayString) {
      result.push({
        kind: 'date',
        timestamp,
        label: formatDateLabel(timestamp, now)
      })
      previousDayString = dayString
    }

    result.push({
      kind: 'group',
      group
    })
  }

  return result
}

/**
 * Finds the array index where the new messages divider should be placed.
 *
 * @param {Array<object>} messages - Chronological array of message rows.
 * @param {string|null} lastReadMessageId - ID of the last read message.
 * @returns {number} Index of first unread message, or -1 if no divider should be rendered.
 */
export function findNewMessagesDivider(messages, lastReadMessageId) {
  if (!Array.isArray(messages) || messages.length === 0 || !lastReadMessageId) {
    return -1
  }

  const index = messages.findIndex((m) => m.message_id === lastReadMessageId)
  if (index === -1 || index === messages.length - 1) {
    return -1
  }

  return index + 1
}

/**
 * Formats a timestamp as a short time string (e.g., '14:32').
 *
 * @param {number} timestamp - Timestamp in milliseconds.
 * @param {object} [options] - Options object.
 * @param {string} [options.locale='en'] - Locale identifier.
 * @returns {string} Formatted short time representation.
 */
export function formatTime(timestamp, { locale = 'en' } = {}) {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}
