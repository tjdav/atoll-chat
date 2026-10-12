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
      room: { type: 'string', minLength: 1 },
      scope: { type: 'string', enum: ['user', 'room'] }
    },
    required: ['key'],
    additionalProperties: false
  },
  create: (config, children) => {
    const key = config.key
    const room = config.room
    const explicitScope = config.scope

    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('settings-read: config.key is required')
    }
    if (room !== undefined && (typeof room !== 'string' || room.length === 0)) {
      throw new Error(
        'settings-read: config.room must be a non-empty string when provided'
      )
    }
    if (explicitScope !== undefined && explicitScope !== 'user' && explicitScope !== 'room') {
      throw new Error('settings-read: config.scope must be "user" or "room"')
    }
    if (explicitScope === 'user' && room !== undefined) {
      throw new Error('settings-read: config.room is not valid when scope is "user"')
    }
    if (!Array.isArray(children)) {
      throw new Error('settings-read: children must be an array')
    }
    if (children.length === 0) {
      throw new Error('settings-read: at least one child is required')
    }

    const hasRoom = room !== undefined
    const effectiveScope = explicitScope === undefined
      ? (hasRoom ? 'room' : 'user')
      : explicitScope

    return async (ctx, input) => {
      const resolvedKey = substitute(key, input)
      if (typeof resolvedKey !== 'string' || resolvedKey.length === 0) {
        throw new Error('settings-read: resolved key is empty')
      }

      let value
      if (effectiveScope === 'user') {
        value = await ctx.settings.get(resolvedKey)
      } else {
        let targetRoom
        if (hasRoom) {
          targetRoom = substitute(room, input)
          if (typeof targetRoom !== 'string' || targetRoom.length === 0) {
            throw new Error('settings-read: resolved room is empty')
          }
        } else {
          targetRoom = ctx.room?.id
          if (typeof targetRoom !== 'string') {
            throw new Error('settings-read: scope "room" requires a room, but none is available')
          }
        }
        value = await ctx.settings.get(resolvedKey, { room: targetRoom })
      }

      let lastResult
      for (const child of children) {
        lastResult = await child(ctx, value)
      }
      return lastResult
    }
  }
}
