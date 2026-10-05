import { defineExtension } from '@atoll/extend'

/**
 * First-party Hangouts/Sessions extension definition (`core.hangouts`).
 */
export default defineExtension({
  id: 'core.hangouts',
  apiVersion: '1.0.0',
  hostApi: '^1.0',
  label: 'Sessions',
  permissions: [],
  list: {
    route: 'sessions',
    title: 'Sessions',
    component: 'extension-placeholder',
    actions: [],
    slots: {}
  },
  detail: {
    route: 'session',
    title: 'Session',
    component: 'extension-placeholder',
    actions: [],
    slots: {},
    surfaces: ['panel'],
    defaultSurface: 'panel',
    back: 'auto',
    scope: {}
  },
  sessions: [
    {
      type: 'voice',
      maxParticipants: 12,
      maxPerRoom: 3,
      heartbeatInterval: 15,
      metadata: {
        name: 'string',
        icon_file_id: 'string?',
        description: 'string?'
      },
      signaling: {
        offer: { sdp: 'string' },
        answer: { sdp: 'string' },
        ice: { candidate: 'string' }
      }
    }
  ]
})
