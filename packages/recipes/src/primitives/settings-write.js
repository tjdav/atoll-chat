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
      scope: { type: 'string', enum: ['user', 'room'] },
      value: {}
    },
    required: ['key'],
    additionalProperties: false
  },
  create: (config, children) => {
    const key = config.key
    const room = config.room
    const explicitScope = config.scope
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
    if (explicitScope !== undefined && explicitScope !== 'user' && explicitScope !== 'room') {
      throw new Error('settings-write: config.scope must be "user" or "room"')
    }
    if (explicitScope === 'user' && room !== undefined) {
      throw new Error('settings-write: config.room is not valid when scope is "user"')
    }
    if (!hasValue) {
      throw new Error('settings-write: config.value is required')
    }
    if (!Array.isArray(children)) {
      throw new Error('settings-write: children must be an array')
    }

    const hasRoom = room !== undefined
    const effectiveScope = explicitScope === undefined
      ? (hasRoom ? 'room' : 'user')
      : explicitScope

    return async (ctx, input) => {
      const resolvedKey = substitute(key, input)
      if (typeof resolvedKey !== 'string' || resolvedKey.length === 0) {
        throw new Error('settings-write: resolved key is empty')
      }

      const resolvedValue = substitute(value, input)

      if (effectiveScope === 'user') {
        await ctx.settings.set(resolvedKey, resolvedValue)
      } else {
        let targetRoom
        if (hasRoom) {
          targetRoom = substitute(room, input)
          if (typeof targetRoom !== 'string' || targetRoom.length === 0) {
            throw new Error('settings-write: resolved room is empty')
          }
        } else {
          targetRoom = ctx.room?.id
          if (typeof targetRoom !== 'string') {
            throw new Error('settings-write: scope "room" requires a room, but none is available')
          }
        }
        await ctx.settings.set(resolvedKey, resolvedValue, { room: targetRoom })
      }

      for (const child of children) {
        await child(ctx, input)
      }
    }
  }
}
