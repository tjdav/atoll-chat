// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Canary: the composer LLM call result contract.
 * Type-check only.
 */

/** @type {ComposerLlmResult} */
const successResult = {
  ok: true,
  content: '{"source":"composed"}',
  parsed: { source: 'composed' }
}

/** @type {ComposerLlmResult} */
const failureResult = {
  ok: false,
  error: {
    code: 'upstream_unreachable',
    message: 'Failed to reach upstream endpoint'
  }
}

/** @type {ComposerLlmResult} */
const statusErrorResult = {
  ok: false,
  error: {
    code: 'upstream_error',
    message: 'Upstream responded with status 502',
    status: 502
  }
}

/** @type {ComposerLlmResult} */
// @ts-expect-error — parsed property is required on ok: true
const missingParsed = {
  ok: true,
  content: '{"source":"composed"}'
}

/** @type {ComposerLlmResult} */
// @ts-expect-error — ok property must be boolean (true or false)
const invalidOkDiscriminator = {
  ok: 'yes',
  content: 'x',
  parsed: {}
}

export {
  successResult,
  failureResult,
  statusErrorResult,
  missingParsed,
  invalidOkDiscriminator
}
