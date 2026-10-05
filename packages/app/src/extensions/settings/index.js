import { defineExtension } from '@atoll/extend'

/**
 * First-party Settings extension definition (`core.settings`).
 */
export default defineExtension({
  id: 'core.settings',
  apiVersion: '1.0.0',
  hostApi: '^1.0',
  label: 'Settings',
  permissions: [],
  rail: {
    icon: { name: 'settings' },
    order: 90,
    mobile: { placement: 'more' }
  },
  list: {
    route: 'settings',
    title: 'Settings',
    component: 'extension-placeholder',
    actions: [],
    slots: {}
  },
  detail: {
    route: 'settings-section',
    title: 'Settings',
    component: 'extension-placeholder',
    actions: [],
    slots: {},
    surfaces: ['panel'],
    defaultSurface: 'panel',
    back: 'auto',
    scope: {}
  }
})
