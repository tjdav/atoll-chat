import { defineExtension } from '@atoll/extend'

/**
 * First-party Documents extension definition (`core.documents`).
 */
export default defineExtension({
  id: 'core.documents',
  apiVersion: '1.0.0',
  hostApi: '^1.0',
  label: 'Documents',
  permissions: [],
  rail: {
    icon: { name: 'document-text' },
    order: 30,
    mobile: { placement: 'bottom', order: 3 }
  },
  list: {
    route: 'documents',
    title: 'Documents',
    component: 'extension-placeholder',
    actions: [],
    slots: {}
  },
  detail: {
    route: 'document',
    title: 'Document',
    component: 'extension-placeholder',
    actions: [],
    slots: {},
    surfaces: ['panel'],
    defaultSurface: 'panel',
    back: 'auto',
    scope: {}
  }
})
