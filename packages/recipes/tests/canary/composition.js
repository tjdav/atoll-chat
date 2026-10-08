// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Canary: PrimitiveInstance nesting is accepted. The Primitive type
 * requires targets and capabilities. Type-check only.
 */

/** @type {Primitive} */
const watchPattern = {
  id: 'watch-pattern',
  targets: ['bot'],
  capabilities: ['read_content'],
  label: 'Watch Pattern',
  description: 'Watch message events for a pattern.',
  configSchema: {},
  create: () => {
  }
}

/** @type {Primitive} */
const renderCard = {
  id: 'render-card',
  targets: ['extension'],
  capabilities: [],
  label: 'Render Card',
  description: 'Render a card in the extension.',
  configSchema: {},
  create: () => {
  }
}

/** @type {PrimitiveInstance} */
const watchWithChild = {
  id: 'watch-for-items',
  primitive: 'watch-pattern',
  config: {
    pattern: 'url',
    source: 'message.new'
  },
  children: [
    {
      id: 'store-item',
      primitive: 'keyed-store',
      config: {
        key: 'item:{match}',
        value: { url: '{match}' }
      }
    }
  ]
}

/** @type {PrimitiveInstance} */
// @ts-expect-error — id is required
const missingId = {
  primitive: 'x',
  config: {}
}

/** @type {PrimitiveInstance} */
// @ts-expect-error — primitive is required
const missingPrimitive = {
  id: 'x',
  config: {}
}

/** @type {Primitive} */
// @ts-expect-error — targets is required on a Primitive
const noTargets = {
  id: 'x',
  label: 'x',
  description: 'x',
  capabilities: [],
  configSchema: {},
  create: () => {
  }
}

/** @type {Primitive} */
// @ts-expect-error — capabilities is required on a Primitive
const noCapabilities = {
  id: 'x',
  label: 'x',
  description: 'x',
  targets: ['bot'],
  configSchema: {},
  create: () => {
  }
}

export { watchPattern, renderCard, watchWithChild, missingId, missingPrimitive, noTargets, noCapabilities }
