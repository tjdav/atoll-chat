// SPDX-License-Identifier: AGPL-3.0-or-later

import { substitute } from '../lib/substitute.js'

/**
 * settings-read reads a bot setting and passes its value to children.
 * The key and the room scope are templates, resolved against the
 * handler input at dispatch time.
 *
 * Children always run, even when the setting is unset. A missing
 * setting is passed as undefined; the recipe decides what to do.
 * @type {Primitive}
 */
export const settingsRead = {
  id: 'settings-read',
  targets: ['bot'],
  capabilities: [],
  label: 'Settings Read',
  description: 'Reads a bot setting and passes its value to children.',
  configSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', minLength: 1 },
      room: { type: 'string', minLength: 1 }
    },
    required: ['key'],
    additionalProperties: false
  },
  create: (config, children) => {
    const key = config.key
    const room = config.room

    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('settings-read: config.key is required')
    }
    if (room !== undefined && (typeof room !== 'string' || room.length === 0)) {
      throw new Error(
        'settings-read: config.room must be a non-empty string when provided'
      )
    }
    if (!Array.isArray(children)) {
      throw new Error('settings-read: children must be an array')
    }
    if (children.length === 0) {
      throw new Error('settings-read: at least one child is required')
    }

    const hasRoom = room !== undefined

    return async (ctx, input) => {
      const resolvedKey = substitute(key, input)
      if (typeof resolvedKey !== 'string' || resolvedKey.length === 0) {
        throw new Error('settings-read: resolved key is empty')
      }

      const opts = {}
      if (hasRoom) {
        const resolvedRoom = substitute(room, input)
        if (typeof resolvedRoom !== 'string' || resolvedRoom.length === 0) {
          throw new Error('settings-read: resolved room is empty')
        }
        opts.room = resolvedRoom
      }

      const value = Object.keys(opts).length === 0
        ? await ctx.settings.get(resolvedKey)
        : await ctx.settings.get(resolvedKey, opts)

      for (const child of children) {
        await child(ctx, value)
      }
    }
  }
}
