// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * post-response posts a text message into a room. It is the primary
 * output primitive. Every recipe that speaks to a room composes it.
 * @type {Primitive}
 */
export const postResponse = {
  id: 'post-response',
  targets: ['bot'],
  capabilities: ['post_message'],
  label: 'Post Response',
  description: 'Posts a text message into a room.',
  configSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        minLength: 1
      },
      roomId: {
        type: 'string',
        minLength: 1
      }
    },
    required: ['text'],
    additionalProperties: false
  },
  create: (config) => {
    const text = config.text
    const overrideRoomId = config.roomId

    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('post-response: config.text is required')
    }
    if (overrideRoomId !== undefined && typeof overrideRoomId !== 'string') {
      throw new Error('post-response: config.roomId must be a string when provided')
    }

    /**
     * @param {any} ctx - The bot invocation context.
     */
    return async (ctx) => {
      const targetRoomId = typeof overrideRoomId === 'string'
        ? overrideRoomId
        : ctx.room?.id

      if (typeof targetRoomId !== 'string') {
        throw new Error('post-response: no target room available')
      }

      await ctx.post({
        text,
        roomId: targetRoomId
      })
    }
  }
}
