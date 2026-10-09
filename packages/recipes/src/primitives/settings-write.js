// SPDX-License-Identifier: AGPL-3.0-or-later

import { substitute } from '../lib/substitute.js'

/**
 * settings-write writes a bot setting. The key, room scope, and
 * value are templates, resolved against the handler input at
 * dispatch time.
 *
 * Children run after a successful write and receive the original
 * input unchanged. This allows a recipe to confirm the write by
 * chaining a post-response.
 * @type {Primitive}
 */
export const settingsWrite = {
  id: 'settings-write',
  targets: ['bot'],
  capabilities: [],
  label: 'Settings Write',
  description: 'Writes a bot setting from a templated value.',
  configSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', minLength: 1 },
      room: { type: 'string', minLength: 1 },
      value: {}
    },
    required: ['key'],
    additionalProperties: false
  },
  create: (config, children) => {
    const key = config.key
    const room = config.room
    const value = config.value
    const hasValue = Object.hasOwn(config, 'value')

    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('settings-write: config.key is required')
    }
    if (room !== undefined && (typeof room !== 'string' || room.length === 0)) {
      throw new Error(
        'settings-write: config.room must be a non-empty string when provided'
      )
    }
    if (!hasValue) {
      throw new Error('settings-write: config.value is required')
    }
    if (!Array.isArray(children)) {
      throw new Error('settings-write: children must be an array')
    }

    const hasRoom = room !== undefined

    return async (ctx, input) => {
      const resolvedKey = substitute(key, input)
      if (typeof resolvedKey !== 'string' || resolvedKey.length === 0) {
        throw new Error('settings-write: resolved key is empty')
      }

      const resolvedValue = substitute(value, input)

      if (hasRoom) {
        const resolvedRoom = substitute(room, input)
        if (typeof resolvedRoom !== 'string' || resolvedRoom.length === 0) {
          throw new Error('settings-write: resolved room is empty')
        }
        await ctx.settings.set(resolvedKey, resolvedValue, { room: resolvedRoom })
      } else {
        await ctx.settings.set(resolvedKey, resolvedValue)
      }

      for (const child of children) {
        await child(ctx, input)
      }
    }
  }
}
