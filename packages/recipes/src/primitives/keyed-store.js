// SPDX-License-Identifier: AGPL-3.0-or-later

import { substitute } from '../lib/substitute.js'

/**
 * keyed-store writes to and reads from ctx.storage. In 'set' mode it
 * stores a value under a key. In 'get' mode it reads a key and passes
 * the stored value to its children as input.
 *
 * Both key and value are templates. `{{path}}` tokens are resolved
 * against the handler input at dispatch time. String values that are
 * exactly one token preserve the resolved value's type.
 * @type {Primitive}
 */
export const keyedStore = {
  id: 'keyed-store',
  targets: ['bot'],
  capabilities: [],
  label: 'Keyed Store',
  description: 'Writes to and reads from bot-scoped storage by key.',
  configSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['set', 'get'], default: 'set' },
      key: { type: 'string', minLength: 1 },
      value: {}
    },
    required: ['key'],
    additionalProperties: false
  },
  create: (config, children) => {
    const mode = config.mode === undefined ? 'set' : config.mode
    const key = config.key
    const value = config.value

    if (mode !== 'set' && mode !== 'get') {
      throw new Error('keyed-store: config.mode must be "set" or "get"')
    }
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('keyed-store: config.key is required')
    }
    if (!Array.isArray(children)) {
      throw new Error('keyed-store: children must be an array')
    }
    if (mode === 'get' && children.length === 0) {
      throw new Error('keyed-store: mode "get" requires at least one child')
    }

    return async (ctx, input) => {
      const resolvedKey = substitute(key, input)

      if (typeof resolvedKey !== 'string' || resolvedKey.length === 0) {
        throw new Error('keyed-store: resolved key is empty')
      }

      if (mode === 'set') {
        const hasValue = Object.hasOwn(config, 'value')
        const resolvedValue = hasValue ? substitute(value, input) : input
        await ctx.storage.set(resolvedKey, resolvedValue)
        return
      }

      const stored = await ctx.storage.get(resolvedKey)
      for (const child of children) {
        await child(ctx, stored)
      }
    }
  }
}
