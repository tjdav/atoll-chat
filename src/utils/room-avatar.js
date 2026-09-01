import { resolveRoomName } from './room-name.js'

const avatarCache = new WeakMap()

/**
 * Parses and caches avatar data for a given room object.
 *
 * @param {Object} room - The room record.
 * @returns {Object|null} The parsed avatar object or null if unavailable/invalid.
 */
export function getParsedAvatar (room) {
  if (!room || !room.avatar) {
    return null
  }

  if (typeof room.avatar !== 'string') {
    return room.avatar
  }

  const cached = avatarCache.get(room)
  if (cached && cached.raw === room.avatar) {
    return cached.parsed
  }

  try {
    const parsed = JSON.parse(room.avatar)
    avatarCache.set(room, { raw: room.avatar, parsed })
    return parsed
  } catch {
    return null
  }
}

/**
 * Creates an atoll-profile element configured for a chat room.
 *
 * @param {Object} room - The room record.
 * @param {Object} options - Configuration options.
 * @param {string} [options.roomName] - Optional resolved room name.
 * @param {string} [options.size='sm'] - Avatar size ('sm', 'md', 'lg', '3xl').
 * @param {Object} [options.currentUser] - Current user record.
 * @param {Object} [options.pb] - Pocketbase client.
 * @param {Object} [options.$media] - Media decryption utility.
 * @param {AbortSignal} [options.signal] - AbortSignal for async decryption.
 * @returns {HTMLElement} The configured atoll-profile DOM element.
 */
export function createRoomAvatar (room, { roomName = '', size = 'sm', currentUser, pb, $media, signal } = {}) {
  const profile = document.createElement('atoll-profile')
  profile.setAttribute('size', size)

  const participants = (room?.participants || []).filter(p => p.id !== currentUser?.id)
  const resolvedName = roomName || resolveRoomName(room, { currentUser })

  if (room?.avatar) {
    const avatarData = getParsedAvatar(room)
    if (avatarData) {
      profile.setAttribute('name', resolvedName)
      profile.setAttribute('alt', resolvedName)
      if ($media && typeof $media.decrypt === 'function' && (avatarData.media_id || avatarData.id)) {
        $media.decrypt(avatarData, {
          roomId: room.id,
          signal
        }).then((url) => {
          profile.setAttribute('src', url)
        }).catch(err => {
          console.error('[room-avatar] Failed to decrypt room avatar:', err)
        })
      }
    } else {
      profile.setAttribute('name', resolvedName)
    }
  } else if (room && !room.is_group && participants.length > 0) {
    const otherUser = participants[0]
    const displayName = otherUser.name || otherUser.username || resolvedName
    profile.setAttribute('name', displayName)
    profile.setAttribute('alt', displayName)
    if (otherUser.id) {
      profile.setAttribute('user-id', otherUser.id)
    }
    if (otherUser.avatar && pb?.files) {
      profile.setAttribute('src', pb.files.getURL(otherUser, otherUser.avatar, { thumb: '50x50' }))
    }
  } else if (room?.is_group) {
    profile.setAttribute('type', 'multiparty')
    const splitCount = Math.min(Math.max(participants.length, 2), 4)
    profile.setAttribute('split-count', splitCount)

    const slotDiv = document.createElement('div')
    slotDiv.setAttribute('slot', 'image')
    const displayCount = Math.min(participants.length, splitCount)
    for (let i = 0; i < displayCount; i++) {
      const p = participants[i]
      const pName = p.name || p.username || 'Member'
      const img = document.createElement('img')
      if (p.avatar && pb?.files) {
        img.src = pb.files.getURL(p, p.avatar, { thumb: '40x40' })
      }
      img.alt = pName
      slotDiv.appendChild(img)
    }
    profile.appendChild(slotDiv)
  } else {
    profile.setAttribute('name', resolvedName)
    profile.setAttribute('alt', resolvedName)
  }

  return profile
}
