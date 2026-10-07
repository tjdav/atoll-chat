import { defineExtension } from '@atoll/extend'

/**
 * First-party Chat extension definition (`core.chat`).
 */
export default defineExtension({
  id: 'core.chat',
  apiVersion: '1.0.0',
  hostApi: '^1.0',
  label: 'Chat',
  permissions: [],
  rail: {
    icon: { name: 'chat-round-line' },
    order: 10,
    mobile: { placement: 'bottom', order: 1 }
  },
  list: {
    route: 'chats',
    title: 'Chats',
    component: 'view-chats',
    actions: [],
    slots: {}
  },
  detail: {
    route: 'chat',
    title: 'Chat',
    component: 'extension-placeholder',
    actions: [],
    slots: {},
    surfaces: ['panel'],
    defaultSurface: 'panel',
    back: 'auto',
    scope: {}
  }
})
