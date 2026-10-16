// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Canary: the POST /v1/compose response contract.
 * Asserts type-checking for composed and refusal ComposeResponse shapes.
 * Type-check only.
 */

/** @type {Composition} */
const validComposition = {
  source: 'composed',
  target: 'bot',
  slots: {},
  handlers: {},
  capabilities: []
}

/** @type {ComposeResponse} */
const composedResponse = {
  kind: 'composed',
  code: 'export default defineBot({})',
  composition: validComposition
}

/** @type {ComposeResponse} */
const refusalResponse = {
  kind: 'refusal',
  reason: 'no_primitive_covers',
  message: 'No primitive covers required capability'
}

/** @type {ComposeResponse} */
const refusalWithErrorsResponse = {
  kind: 'refusal',
  reason: 'validation_failed',
  message: 'Composition validation failed',
  errors: [
    {
      code: 'invalid_shape',
      path: 'target',
      message: 'Target is required'
    }
  ]
}

/** @type {ComposeResponse} */
// @ts-expect-error — code is required on composed ComposeResponse
const missingCodeComposed = {
  kind: 'composed',
  composition: validComposition
}

/** @type {ComposeResponse} */
// @ts-expect-error — kind must be 'composed' or 'refusal'
const invalidKindResponse = {
  kind: 'ok',
  code: 'some code'
}

export {
  validComposition,
  composedResponse,
  refusalResponse,
  refusalWithErrorsResponse,
  missingCodeComposed,
  invalidKindResponse
}
