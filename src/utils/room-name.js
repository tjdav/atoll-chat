/**
 * Resolves the display name for a chat room according to standard application rules:
 * 1. Priority 1: If room has a custom name set by admin/creator, use room.name.
 * 2. Priority 2 (1:1 DM): Defaults to the other participant's nickname, name, or username. Never 'Direct Message'.
 * 3. Priority 3 (Unnamed Group): Defaults to participant names (e.g. "Alice, Bob" or "Alice, Bob, Charlie +2"). Never 'Unnamed Group'.
 * 4. Priority 4: Fallback to 'Unknown Chat' if room is null.
 *
 * @param {Object} room - The room record.
 * @param {Object} [options] - Options for name resolution.
 * @param {Object|string} [options.currentUser] - The currently logged-in user object or ID.
 * @param {Object} [options.nicknames] - Optional mapping of userId -> custom local nickname.
 * @param {string} [options.fallback='Unknown Chat'] - Fallback when room record is null.
 * @returns {string} The resolved display name.
 */
export function resolveRoomName (room, { currentUser, nicknames = {}, fallback = 'Unknown Chat' } = {}) {
  if (!room) {
    return fallback
  }

  const currentUserId = typeof currentUser === 'string' ? currentUser : (currentUser?.id || '')
  const participants = Array.isArray(room.participants) ? room.participants : []
  const otherParticipants = participants.filter(p => p && (p.id || p.user_id) !== currentUserId)

  // Priority 1: Explicit custom room name set by admin / user
  if (room.name && typeof room.name === 'string' && room.name.trim()) {
    return room.name.trim()
  }

  const getParticipantDisplayName = (p) => {
    if (!p) {
      return ''
    }
    const pId = p.id || p.user_id
    const nick = (nicknames && nicknames[pId]) || (room.nicknames && room.nicknames[pId])
    return nick || p.name || p.username || ''
  }

  // Priority 2: Direct Message
  if (!room.is_group) {
    if (otherParticipants.length > 0) {
      const other = otherParticipants[0]
      return getParticipantDisplayName(other) || 'Chat'
    }
    if (participants.length > 0) {
      const self = participants[0]
      return getParticipantDisplayName(self) || 'Chat'
    }
    return 'Chat'
  }

  // Priority 3: Unnamed Group Chat (format participant names, max 3 + count)
  const relevantParticipants = otherParticipants.length > 0 ? otherParticipants : participants
  const participantNames = relevantParticipants
    .map(p => getParticipantDisplayName(p))
    .filter(name => Boolean(name && name.trim()))

  if (participantNames.length === 0) {
    return 'Group'
  }

  if (participantNames.length <= 3) {
    return participantNames.join(', ')
  }

  const firstThree = participantNames.slice(0, 3).join(', ')
  const remainingCount = participantNames.length - 3
  return `${firstThree} +${remainingCount}`
}
