// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Canary: the Recipe typedef accepts well-formed recipes and rejects
 * malformed ones. Type-check only.
 */

/** @type {Recipe} */
const validBotRecipe = {
  id: 'searchable-store',
  version: '1.0.0',
  label: 'Searchable Store',
  description: 'Save and search items.',
  kind: 'pure',
  targets: ['bot'],
  capabilities: ['read_commands', 'post_message'],
  slots: [
    {
      name: 'itemName',
      type: 'string',
      question: 'What are you saving?'
    }
  ],
  handlers: {
    install: {
      id: 'install-hook',
      primitive: 'post-response',
      config: {
        scope: 'room',
        text: 'Ready.'
      }
    }
  }
}

/* A recipe with no targets field is valid — defaults to ['bot']. */
/** @type {Recipe} */
const noTargets = {
  id: 'x',
  version: '1.0.0',
  label: 'X',
  description: 'X',
  kind: 'pure',
  capabilities: [],
  slots: [],
  handlers: {}
}

/* A recipe may target an extension instead of a bot. */
/** @type {Recipe} */
const extensionRecipe = {
  id: 'dm-console',
  version: '1.0.0',
  label: 'DM Console',
  description: 'Compose NPC responses.',
  kind: 'pure',
  targets: ['extension'],
  capabilities: [],
  slots: [],
  handlers: {}
}

/** @type {Recipe} */
// @ts-expect-error — kind is required
const missingKind = {
  id: 'x',
  version: '1.0.0',
  label: 'x',
  description: 'x',
  capabilities: [],
  slots: [],
  handlers: {}
}

/** @type {Recipe} */
const wrongKind = {
  ...validBotRecipe,
  // @ts-expect-error — kind must be one of the three literals
  kind: 'magic'
}

/** @type {Recipe} */
const wrongSlot = {
  ...validBotRecipe,
  slots: [
    {
      name: 'x',
      // @ts-expect-error — slot type must be one of the four literals
      type: 'color',
      question: 'x'
    }
  ]
}

/** @type {Recipe} */
const wrongTarget = {
  ...validBotRecipe,
  // @ts-expect-error — target must be 'bot' or 'extension'
  targets: ['widget']
}

export {
  validBotRecipe,
  noTargets,
  extensionRecipe,
  missingKind,
  wrongKind,
  wrongSlot,
  wrongTarget
}
