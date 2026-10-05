import { defineExtension } from '@atoll/extend'

/**
 * First-party Profile extension definition (`core.profile`).
 */
export default defineExtension({
  id: 'core.profile',
  apiVersion: '1.0.0',
  hostApi: '^1.0',
  label: 'Profile',
  permissions: [],
  detail: {
    route: 'profile',
    title: 'Profile',
    component: 'extension-placeholder',
    actions: [],
    slots: {},
    surfaces: ['panel'],
    defaultSurface: 'panel',
    back: 'auto',
    scope: {}
  }
})
