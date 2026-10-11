// SPDX-License-Identifier: AGPL-3.0-or-later

import { substitute } from '../lib/substitute.js'

/**
 * reply-local returns a message visible only to the command
 * invoker. Unlike post-response, which posts to the room, and
 * send-local, which sends to the bot owner, reply-local produces a
 * CommandResult that the SDK routes to whoever ran the command.
 *
 * The primitive is terminal. It does not dispatch to children. Its
 * return value is the command's result.
 * @type {Primitive}
 */
export const replyLocal = {
  id: 'reply-local',
  targets: ['bot'],
  capabilities: [],
  label: 'Reply Local',
  description: 'Returns a message visible only to the command invoker.',
  configSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 1 }
    },
    required: ['text'],
    additionalProperties: false
  },
  create: (config) => {
    const text = config.text

    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('reply-local: config.text is required')
    }

    return async (ctx, input) => {
      const resolved = substitute(text, input)
      const content = String(resolved)
      if (content.length === 0) {
        throw new Error('reply-local: resolved text is empty')
      }
      return { type: 'local_message', content }
    }
  }
}
