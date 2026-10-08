/**
 * Seed data definitions for storage fixture tests.
 * Plain JS object with no external dependencies.
 */
export const SEEDS = {
  empty: {
    rooms: [],
    members: [],
    users: [],
    messages: [],
    readStates: []
  },
  chatEmpty: {
    rooms: [{ roomId: 'r_1', name: 'Test Room' }],
    members: [
      { roomId: 'r_1', userId: 'u_me', role: 'owner' },
      { roomId: 'r_1', userId: 'u_alice', role: 'member' }
    ],
    users: [{ userId: 'u_alice', displayName: 'Alice' }],
    messages: [],
    readStates: []
  },
  chatWithMessages: {
    rooms: [{ roomId: 'r_1', name: 'Test Room' }],
    members: [
      { roomId: 'r_1', userId: 'u_me', role: 'owner' },
      { roomId: 'r_1', userId: 'u_alice', role: 'member' }
    ],
    users: [{ userId: 'u_alice', displayName: 'Alice' }],
    messages: [
      // Five messages from Alice, one from the user, one tombstone.
      // Timestamps are computed at seed time so "1h ago" is stable.
      { id: 'm_1', from: 'u_alice', text: 'Hello', offsetMs: -60 * 60 * 1000, status: 'sent' },
      { id: 'm_2', from: 'u_alice', text: 'How are you?', offsetMs: -59 * 60 * 1000, status: 'sent' },
      { id: 'm_3', from: 'u_me', text: 'Good, thanks', offsetMs: -58 * 60 * 1000, status: 'sent' },
      { id: 'm_4', from: 'u_me', text: 'Draft message', offsetMs: -57 * 60 * 1000, status: 'pending' },
      { id: 'm_5', from: 'u_alice', text: 'Bye', offsetMs: -56 * 60 * 1000, status: 'sent', deleted: true },
      { id: 'm_6', from: 'u_me', text: 'Old', offsetMs: -25 * 60 * 60 * 1000, status: 'sent' },
      { id: 'm_7', from: 'u_me', text: 'Editable message', offsetMs: -5 * 60 * 1000, status: 'sent' }
    ],
    readStates: [
      // Mark m_1 and m_2 as read for u_me
      { roomId: 'r_1', userId: 'u_me', lastReadMessageId: 'm_2' }
    ]
  }
}
