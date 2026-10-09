// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * send-local sends a message visible only to the bot's owner. It is
 * used for private replies: the operator sees the output, no one
 * else in the room does. Non-durable and best-effort, per the bot
 * SDK's LocalOptions contract.
 * @type {Primitive}
 */
export const sendLocal = {
  id: 'send-local',
  targets: ['bot'],
  capabilities: [],
  label: 'Send Local',
  description: 'Sends a message visible only to the bot owner.',
  configSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 1 },
      format: { type: 'string', enum: ['text', 'markdown'] }
    },
    required: ['text'],
    additionalProperties: false
  },
  create: (config) => {
    const text = config.text
    const format = config.format

    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('send-local: config.text is required')
    }
    if (format !== undefined && format !== 'text' && format !== 'markdown') {
      throw new Error('send-local: config.format must be "text" or "markdown"')
    }

    /**
     * @param {any} ctx - The bot invocation context.
     */
    return async (ctx) => {
      /** @type {{ text: string, format?: string }} */
      const opts = { text }
      if (typeof format === 'string') {
        opts.format = format
      }
      await ctx.sendLocal(opts)
    }
  }
}
