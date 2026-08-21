/**
 * Groups an array of standardized media items by roomId.
 * - Sorts room groups by newest item timestamp descending.
 * - Sorts items within each room group newest to oldest.
 *
 * @param {Array<Object>} items - Array of enriched items { id, item, roomId, room, roomName, createdAt, ... }
 * @returns {Array<{ roomId: string, room: Object, roomName: string, items: Array<Object> }>}
 */
export function groupItemsByRoom (items) {
  if (!items || items.length === 0) {
    return []
  }

  const roomMap = new Map()
  for (const entry of items) {
    const roomId = entry.roomId || entry.item?.room_id || 'unknown'
    if (!roomMap.has(roomId)) {
      roomMap.set(roomId, {
        roomId,
        room: entry.room || null,
        roomName: entry.roomName || 'Unknown Chat',
        latestTimestamp: new Date(entry.createdAt || entry.item?.created_at || 0).getTime(),
        items: []
      })
    }
    const group = roomMap.get(roomId)
    const itemTimestamp = new Date(entry.createdAt || entry.item?.created_at || 0).getTime()
    if (itemTimestamp > group.latestTimestamp) {
      group.latestTimestamp = itemTimestamp
    }
    group.items.push(entry)
  }

  for (const group of roomMap.values()) {
    group.items.sort((a, b) => {
      const timeA = new Date(a.createdAt || a.item?.created_at || 0).getTime()
      const timeB = new Date(b.createdAt || b.item?.created_at || 0).getTime()
      return timeB - timeA
    })
  }

  return Array.from(roomMap.values()).sort((a, b) => b.latestTimestamp - a.latestTimestamp)
}
