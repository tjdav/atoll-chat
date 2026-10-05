import { defineExtension } from '@atoll/extend'

/**
 * First-party Links extension definition (`core.links`).
 */
export default defineExtension({
  id: 'core.links',
  apiVersion: '1.0.0',
  hostApi: '^1.0',
  label: 'Links',
  permissions: [],
  rail: {
    icon: { name: 'link' },
    order: 40,
    mobile: { placement: 'more' }
  },
  list: {
    route: 'links',
    title: 'Links',
    component: 'extension-placeholder',
    actions: [],
    slots: {}
  },
  detail: {
    route: 'link',
    title: 'Link',
    component: 'extension-placeholder',
    actions: [],
    slots: {},
    surfaces: ['panel'],
    defaultSurface: 'panel',
    back: 'auto',
    scope: {}
  }
})
