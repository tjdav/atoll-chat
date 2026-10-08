// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Canary: a Composition carries its target, and a BotScript wraps a
 * Composition. Type-check only.
 */

/** @type {Composition} */
const composition = {
  recipeId: 'searchable-store',
  recipeVersion: '1.0.0',
  target: 'bot',
  slots: {
    itemName: 'bookmark'
  },
  handlers: {},
  capabilities: ['read_commands', 'post_message']
}

/** @type {BotScript} */
const script = {
  code: '// generated',
  composition
}

/** @type {Composition} */
const wrongTarget = {
  ...composition,
  // @ts-expect-error — target must be 'bot' or 'extension'
  target: 'widget'
}

/** @type {BotScript} */
// @ts-expect-error — code is required
const noCode = {
  composition
}

/** @type {BotScript} */
// @ts-expect-error — composition is required
const noComposition = {
  code: '// generated'
}

export {
  composition,
  script,
  wrongTarget,
  noCode,
  noComposition
}
