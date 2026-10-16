// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Canary: the composer prompt message contract.
 * Type-check only.
 */

/** @type {ComposerMessage} */
const systemMessage = {
  role: 'system',
  content: 'You are the bot composer.'
}

/** @type {ComposerMessage} */
const userMessage = {
  role: 'user',
  content: 'The user wants: a bot'
}

/** @type {ComposerMessage[]} */
const messageArray = [
  systemMessage,
  userMessage
]

/** @type {ComposerMessage} */
// @ts-expect-error — role must be 'system' or 'user'
const invalidRole = {
  role: 'assistant',
  content: 'Invalid role'
}

/** @type {ComposerMessage} */
// @ts-expect-error — content must be a string
const invalidContent = {
  role: 'system',
  content: 123
}

export {
  systemMessage,
  userMessage,
  messageArray,
  invalidRole,
  invalidContent
}
