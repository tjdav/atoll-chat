import { defineExtension } from '@atoll/extend'

/**
 * First-party Media extension definition (`core.media`).
 */
export default defineExtension({
  id: 'core.media',
  apiVersion: '1.0.0',
  hostApi: '^1.0',
  label: 'Media',
  permissions: [],
  rail: {
    icon: { name: 'gallery' },
    order: 20,
    mobile: { placement: 'bottom', order: 2 }
  },
  list: {
    route: 'media',
    title: 'Media',
    component: 'extension-placeholder',
    actions: [],
    slots: {}
  },
  detail: {
    route: 'media-viewer',
    title: 'Media viewer',
    component: 'extension-placeholder',
    actions: [],
    slots: {},
    surfaces: ['panel'],
    defaultSurface: 'panel',
    back: 'auto',
    scope: {}
  }
})
