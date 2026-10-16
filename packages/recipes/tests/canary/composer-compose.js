// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Canary: the composeBot entry point result shapes.
 * Asserts type-checking for composed and refusal outcomes.
 */

/** @type {import('../../src/types.js').Composition} */
const validComposition = {
  source: 'composed',
  target: 'bot',
  slots: {},
  handlers: {
    message: {
      id: 'msg-1',
      primitive: 'post-response',
      config: { text: 'Hello' }
    }
  },
  capabilities: ['post_message']
}

/** @type {import('../../src/types.js').ComposeBotResult} */
const composedResult = {
  kind: 'composed',
  composition: validComposition
}

/** @type {import('../../src/types.js').ComposeBotResult} */
const wireRefusalResult = {
  kind: 'refusal',
  reason: 'composer_unavailable',
  message: 'The composer service is currently unavailable.'
}

/** @type {import('../../src/types.js').ComposeBotResult} */
const validationRefusalResult = {
  kind: 'refusal',
  reason: 'validation_failed',
  message: 'The composer could not produce a valid composition.',
  errors: [{
    code: 'INSTANCE_INVALID_CONFIG',
    path: 'handlers.message.config.text',
    message: 'handlers.message.config.text is required'
  }]
}

/** @type {import('../../src/types.js').ComposeBotResult} */
// @ts-expect-error — composition property is required when kind is 'composed'
const missingComposition = {
  kind: 'composed'
}

/** @type {import('../../src/types.js').ComposeBotResult} */
// @ts-expect-error — kind must be 'composed' or 'refusal'
const wrongKindResult = {
  kind: 'success',
  composition: validComposition
}

export {
  composedResult,
  wireRefusalResult,
  validationRefusalResult,
  missingComposition,
  wrongKindResult
}
