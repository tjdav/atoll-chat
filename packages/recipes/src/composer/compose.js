// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildComposerMessages } from './prompt.js'
import { completeComposition } from './llm.js'
import { validateComposition } from './validate.js'

/**
 * Deeply freezes an object or array and all nested properties.
 * @template T
 * @param {T} obj - The object to deep freeze.
 * @returns {T} The frozen object.
 */
function deepFreeze (obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  Object.freeze(obj)
  for (const prop of Object.getOwnPropertyNames(obj)) {
    // @ts-expect-error — indexing obj by property name string
    const val = obj[prop]
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val)
    }
  }
  return obj
}

/**
 * Helper to construct a refusal result object.
 * @param {string} reason - The refusal reason ('composer_unavailable' | 'validation_failed').
 * @param {string} message - Human-readable explanation.
 * @param {import('../types.js').CompositionValidationError[]} [errors] - Second attempt's validation errors if reason is 'validation_failed'.
 * @returns {import('../types.js').ComposeBotResult} The refusal result.
 */
function refuse (reason, message, errors) {
  if (errors !== undefined) {
    return {
      kind: 'refusal',
      reason,
      message,
      errors
    }
  }
  return {
    kind: 'refusal',
    reason,
    message
  }
}

/**
 * Internal recursive attempt handler.
 * @param {import('../types.js').ComposerLlmResult} result - Result from completeComposition.
 * @param {{ intent: string, options: import('../types.js').ComposeBotOptions, errors?: import('../types.js').CompositionValidationError[] }} ctx - Execution context.
 * @returns {Promise<import('../types.js').ComposeBotResult>} The compose bot result.
 */
async function handleAttempt (result, ctx) {
  if (!result.ok) {
    if (result.error.code === 'invalid_json_content') {
      const syntheticErrors = [{
        code: 'invalid_json_content',
        path: '(root)',
        message: 'Response content is not valid JSON'
      }]
      if (!ctx.errors) {
        const retryMessages = buildComposerMessages(
          {
            intent: ctx.intent,
            previousErrors: syntheticErrors
          },
          ctx.options.registry,
          ctx.options.library
        )
        const retryResult = await completeComposition(retryMessages, ctx.options.llm)
        return handleAttempt(retryResult, {
          ...ctx,
          errors: syntheticErrors
        })
      }
      return refuse('validation_failed', 'The composer could not produce a valid composition.', syntheticErrors)
    }
    return refuse('composer_unavailable', 'The composer service is currently unavailable.', undefined)
  }

  const verdict = validateComposition(result.parsed, ctx.options.registry)
  if (verdict.valid) {
    return {
      kind: 'composed',
      composition: deepFreeze(verdict.composition)
    }
  }

  if (!ctx.errors) {
    const retryMessages = buildComposerMessages(
      {
        intent: ctx.intent,
        previousErrors: verdict.errors
      },
      ctx.options.registry,
      ctx.options.library
    )
    const retryResult = await completeComposition(retryMessages, ctx.options.llm)
    return handleAttempt(retryResult, {
      ...ctx,
      errors: verdict.errors
    })
  }

  return refuse(
    'validation_failed',
    'The composer could not produce a valid composition.',
    verdict.errors
  )
}

/**
 * Entry point for the bot composer.
 * @param {string} intent - The user's natural language intent.
 * @param {import('../types.js').ComposeBotOptions} options - Options for registry, library, and LLM call.
 * @returns {Promise<import('../types.js').ComposeBotResult>} Result containing a frozen Composition or refusal.
 */
export async function composeBot (intent, options) {
  if (typeof intent !== 'string' || intent.length === 0) {
    throw new TypeError('composeBot: intent must be a non-empty string')
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('composeBot: options must be an object')
  }

  const messages = buildComposerMessages({ intent }, options.registry, options.library)
  const result = await completeComposition(messages, options.llm)
  return handleAttempt(result, {
    intent,
    options
  })
}
