import { defineExtension } from '@atoll/extend'

/**
 * First-party Join extension definition (`core.join`).
 */
export default defineExtension({
  id: 'core.join',
  apiVersion: '1.0.0',
  hostApi: '^1.0',
  label: 'Join',
  permissions: [],
  detail: {
    route: 'join',
    title: 'Join',
    component: 'extension-placeholder',
    actions: [],
    slots: {},
    surfaces: ['panel'],
    defaultSurface: 'panel',
    back: 'auto',
    scope: {}
  }
})
