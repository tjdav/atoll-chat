/**
 * Formats a timestamp into a relative time string (e.g., 'now', '5m', '3h', '2d').
 *
 * @param {number} ms - Timestamp in milliseconds.
 * @param {number} [now=Date.now()] - Current reference timestamp in milliseconds.
 * @returns {string} Relative time representation.
 */
export function formatRelativeTime(ms, now = Date.now()) {
  if (!ms) return ''
  const delta = now - ms
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (delta < minute) return 'now'
  if (delta < hour) return `${Math.floor(delta / minute)}m`
  if (delta < day) return `${Math.floor(delta / hour)}h`
  return `${Math.floor(delta / day)}d`
}

/**
 * Resolves the display name for a room based on explicit name or member display names.
 *
 * @param {object} room - Room record containing optional name property.
 * @param {string[]} displayNames - Array of display names for other room members.
 * @param {object} translations - Object containing localized strings.
 * @returns {string} Derived room display name.
 */
export function resolveRoomName(room, displayNames, translations) {
  if (room && room.name) return room.name
  if (!displayNames || displayNames.length === 0) {
    return translations?.chats_preview_no_messages || 'No messages yet'
  }
  if (displayNames.length === 1) return displayNames[0]
  if (displayNames.length === 2) return `${displayNames[0]}, ${displayNames[1]}`
  return `${displayNames[0]}, ${displayNames[1]} + ${displayNames.length - 2}`
}

/**
 * Safely parses JSON string or returns null on failure.
 *
 * @param {string|null} json - JSON string to parse.
 * @returns {object|null} Parsed object or null.
 */
function safeParsePayload(json) {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/**
 * Resolves the message preview string for a room's last message.
 *
 * @param {object|null} lastMessage - Message record with decrypted payload.
 * @param {string[]} displayNames - Array of display names for other room members.
 * @param {string} currentUserId - ID of the currently logged-in user.
 * @param {object} translations - Object containing localized strings.
 * @returns {string} Derived message preview string.
 */
export function resolvePreview(lastMessage, displayNames, currentUserId, translations) {
  if (!lastMessage) {
    return translations?.chats_preview_no_messages || 'No messages yet'
  }
  const payload = safeParsePayload(lastMessage.decrypted_payload)
  if (!payload) {
    return translations?.chats_preview_no_messages || 'No messages yet'
  }

  const isSelf = lastMessage.sender_user_id === currentUserId
  const prefix = isSelf
    ? `${translations?.chats_preview_you_prefix || 'You'}: `
    : `${displayNames[0] ?? 'Unknown'}: `

  switch (payload.type) {
    case 'text':
      return `${prefix}${payload.text ?? ''}`
    case 'image':
      return `${prefix}${translations?.chats_preview_photo || 'Photo'}`
    case 'video':
      return `${prefix}${translations?.chats_preview_video || 'Video'}`
    case 'audio':
      return `${prefix}${translations?.chats_preview_voice || 'Voice message'}`
    case 'file':
      return `${prefix}${translations?.chats_preview_document || 'Document'}`
    case 'sticker':
      return `${prefix}${translations?.chats_preview_sticker || 'Sticker'}`
    default:
      return `${prefix}${translations?.chats_preview_no_messages || 'No messages yet'}`
  }
}

/**
 * Computes whether a room has unread messages relative to the user's read state.
 *
 * @param {object|null} readState - User's read state record for the room.
 * @param {object|null} lastMessage - Room's newest application message record.
 * @returns {boolean} True if unread, false otherwise.
 */
export function computeUnread(readState, lastMessage) {
  if (!lastMessage) return false
  if (!readState) return true
  return readState.last_read_message_id !== lastMessage.message_id
}

/**
 * Assembles raw database rows into structured conversation view model objects.
 *
 * @param {object} params - Input data collections.
 * @param {Array} params.rooms - Raw room records.
 * @param {Array} [params.orderRows=[]] - Ordered room IDs or records.
 * @param {Array|Map} [params.readStates=[]] - Read state records.
 * @param {Array|Map} [params.drafts=[]] - Draft records.
 * @param {object|Map} [params.lastMessagesByRoom={}] - Map of room ID to last message record.
 * @param {object|Map} [params.displayNamesByRoom={}] - Map of room ID to display names array.
 * @param {object|Map} [params.memberCountsByRoom={}] - Map of room ID to total member count.
 * @param {string} params.currentUserId - ID of currently logged-in user.
 * @param {object} params.translations - Object containing localized string templates.
 * @param {number} [params.now=Date.now()] - Current reference timestamp.
 * @returns {Array<object>} Assembled room objects ready for rendering.
 */
export function assembleRooms({
  rooms = [],
  orderRows = [],
  readStates = [],
  drafts = [],
  lastMessagesByRoom = {},
  displayNamesByRoom = {},
  memberCountsByRoom = {},
  currentUserId = '',
  translations = {},
  now = Date.now()
}) {
  const normalizedOrder = orderRows.map((item) => (typeof item === 'string' ? item : item?.room_id))
  const orderIndex = new Map(normalizedOrder.map((id, i) => [id, i]))

  const sortedRooms = rooms.slice().sort((a, b) => {
    const ai = orderIndex.get(a.room_id) ?? Number.POSITIVE_INFINITY
    const bi = orderIndex.get(b.room_id) ?? Number.POSITIVE_INFINITY
    if (ai !== bi) return ai - bi
    return (b.updated_at ?? 0) - (a.updated_at ?? 0)
  })

  const readByRoom = Array.isArray(readStates)
    ? new Map(readStates.map((r) => [r.room_id, r]))
    : readStates instanceof Map
      ? readStates
      : new Map(Object.entries(readStates))

  const draftByRoom = Array.isArray(drafts)
    ? new Map(drafts.map((d) => [d.room_id, d]))
    : drafts instanceof Map
      ? drafts
      : new Map(Object.entries(drafts))

  return sortedRooms.map((room) => {
    const roomId = room.room_id
    const lastMessage = lastMessagesByRoom instanceof Map
      ? lastMessagesByRoom.get(roomId)
      : lastMessagesByRoom[roomId] ?? null

    const displayNames = displayNamesByRoom instanceof Map
      ? displayNamesByRoom.get(roomId)
      : displayNamesByRoom[roomId] ?? []

    const readState = readByRoom.get(roomId)
    const draft = draftByRoom.get(roomId)
    const hasDraft = Boolean(draft)

    const name = resolveRoomName(room, displayNames, translations)
    const preview = hasDraft
      ? draft.text
      : resolvePreview(lastMessage, displayNames, currentUserId, translations)
    const timestamp = lastMessage ? formatRelativeTime(lastMessage.created_at, now) : ''
    const isUnread = computeUnread(readState, lastMessage)

    const rawMemberCount = memberCountsByRoom instanceof Map
      ? memberCountsByRoom.get(roomId)
      : memberCountsByRoom[roomId]
    const memberCount = typeof rawMemberCount === 'number' ? rawMemberCount : displayNames.length + 1
    const isGroup = memberCount > 2

    return {
      roomId,
      name,
      preview,
      timestamp,
      isUnread,
      hasDraft,
      isGroup
    }
  })
}
