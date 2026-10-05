import { defineExtension } from '@atoll/extend'

/**
 * First-party Calls extension definition (`core.calls`).
 */
export default defineExtension({
  id: 'core.calls',
  apiVersion: '1.0.0',
  hostApi: '^1.0',
  label: 'Calls',
  permissions: [],
  rail: {
    icon: { name: 'phone' },
    order: 50,
    mobile: { placement: 'more' }
  },
  list: {
    route: 'calls',
    title: 'Calls',
    component: 'extension-placeholder',
    actions: [],
    slots: {}
  },
  detail: {
    route: 'call',
    title: 'Call',
    component: 'extension-placeholder',
    actions: [],
    slots: {},
    surfaces: ['panel'],
    defaultSurface: 'panel',
    back: 'auto',
    scope: {}
  }
})
