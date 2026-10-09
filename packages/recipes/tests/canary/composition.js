// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Canary: the composition contract. PrimitiveInstance nesting is
 * accepted. Primitive.create accepts config and children, and
 * returns a Handler. Type-check only.
 */

/** @type {Primitive} */
const watchPattern = {
  id: 'watch-pattern',
  targets: ['bot'],
  capabilities: ['read_content'],
  label: 'Watch Pattern',
  description: 'Watch message events for a pattern.',
  configSchema: {},
  create: (config, children) => {
    return async (ctx, input) => {
      for (const child of (children ?? [])) {
        await child(ctx, input)
      }
    }
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
  create: () => () => {
  }
}

/** @type {PrimitiveInstance} */
const watchWithChild = {
  id: 'watch-for-items',
  primitive: 'watch-pattern',
  config: { pattern: 'url' },
  children: [
    {
      id: 'store-item',
      primitive: 'keyed-store',
      config: { key: 'item:{match}' }
    }
  ]
}

/** @type {Handler} */
const identityHandler = (ctx, input) => input

/** @type {Handler} */
const asyncHandler = async (ctx, input) => {
  return input
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
  create: () => () => {
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
  create: () => () => {
  }
}

/** @type {Primitive} */
const wrongCreate = {
  id: 'x',
  targets: ['bot'],
  capabilities: [],
  label: 'x',
  description: 'x',
  configSchema: {},
  // @ts-expect-error — create must accept children as its second parameter
  create: (_config) => 'not a handler'
}

export {
  watchPattern,
  renderCard,
  watchWithChild,
  identityHandler,
  asyncHandler,
  missingId,
  missingPrimitive,
  noTargets,
  noCapabilities,
  wrongCreate
}
