import { defineExtension } from '@atoll/extend'

/**
 * First-party Admin extension definition (`core.admin`).
 */
export default defineExtension({
  id: 'core.admin',
  apiVersion: '1.0.0',
  hostApi: '^1.0',
  label: 'Admin',
  permissions: [],
  list: {
    route: 'admin',
    title: 'Admin',
    component: 'extension-placeholder',
    actions: [],
    slots: {}
  },
  detail: {
    route: 'admin-section',
    title: 'Admin',
    component: 'extension-placeholder',
    actions: [],
    slots: {},
    surfaces: ['panel'],
    defaultSurface: 'panel',
    back: 'auto',
    scope: {}
  }
})
