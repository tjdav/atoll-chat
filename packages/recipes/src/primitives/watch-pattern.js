// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * watch-pattern watches message events for a regular expression
 * match. When the pattern matches, it calls each child handler with
 * the match result and the event. When the pattern does not match,
 * or when the primitive is disabled, it does nothing.
 *
 * This is the first composite primitive. It establishes the pattern
 * every later composite follows: create receives the resolved child
 * handlers, and the handler it returns invokes them with an input.
 * @type {Primitive}
 */
export const watchPattern = {
  id: 'watch-pattern',
  targets: ['bot'],
  capabilities: ['read_content'],
  label: 'Watch Pattern',
  description: 'Watches message events for a pattern and calls children on match.',
  configSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        minLength: 1
      },
      flags: { type: 'string' },
      enabled: {
        type: 'boolean',
        default: true
      }
    },
    required: ['pattern'],
    additionalProperties: false
  },
  create: (config, children) => {
    const pattern = config.pattern
    const flags = config.flags
    const enabled = config.enabled === undefined ? true : config.enabled

    if (typeof pattern !== 'string' || pattern.length === 0) {
      throw new Error('watch-pattern: config.pattern is required')
    }
    if (flags !== undefined && typeof flags !== 'string') {
      throw new Error('watch-pattern: config.flags must be a string')
    }
    if (typeof enabled !== 'boolean') {
      throw new Error('watch-pattern: config.enabled must be a boolean')
    }
    if (!Array.isArray(children)) {
      throw new Error('watch-pattern: children must be an array')
    }

    let regex
    try {
      regex = new RegExp(pattern, flags ?? '')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`watch-pattern: invalid pattern: ${msg}`)
    }

    return async (ctx, input) => {
      if (enabled === false) {
        return
      }
      if (!input || typeof input !== 'object') {
        return
      }
      /** @type {any} */
      const rawInput = input
      const data = rawInput.data
      if (!data || typeof data !== 'object') {
        return
      }
      if (!('plaintext' in data)) {
        return
      }
      /** @type {any} */
      const rawData = data
      const text = rawData.plaintext
      if (typeof text !== 'string') {
        return
      }
      const match = text.match(regex)
      if (!match) {
        return
      }
      const payload = {
        match: match[0],
        event: input
      }
      for (const child of children) {
        await child(ctx, payload)
      }
    }
  }
}
