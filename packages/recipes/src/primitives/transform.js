// SPDX-License-Identifier: AGPL-3.0-or-later

import { readPath } from '../lib/path.js'

const VALID_OPS = ['json', 'stringify', 'pick']

/**
 * transform reshapes the handler input before passing it to
 * children. Three operations are supported: parse a JSON string,
 * serialize a value to JSON, and extract a nested path.
 *
 * Children receive the transformed output, not the original input.
 * This differs from settings-write, which passes the input through
 * unchanged.
 * @type {Primitive}
 */
export const transform = {
  id: 'transform',
  targets: ['bot'],
  capabilities: [],
  label: 'Transform',
  description: 'Reshapes the input before passing it to children.',
  configSchema: {
    type: 'object',
    properties: {
      op: { type: 'string', enum: ['json', 'stringify', 'pick'] },
      path: { type: 'string', minLength: 1 }
    },
    required: ['op'],
    additionalProperties: false
  },
  create: (config, children) => {
    const op = config.op
    const path = config.path

    if (!VALID_OPS.includes(op)) {
      throw new Error(
        'transform: config.op must be one of json, stringify, pick'
      )
    }
    if (op === 'pick') {
      if (typeof path !== 'string' || path.length === 0) {
        throw new Error('transform: config.path is required when op is "pick"')
      }
    } else if (path !== undefined) {
      throw new Error(
        'transform: config.path is only valid when op is "pick"'
      )
    }
    if (!Array.isArray(children)) {
      throw new Error('transform: children must be an array')
    }
    if (children.length === 0) {
      throw new Error('transform: at least one child is required')
    }

    return async (ctx, input) => {
      let output

      if (op === 'json') {
        if (typeof input !== 'string') {
          throw new Error('transform: op "json" requires a string input')
        }
        try {
          output = JSON.parse(input)
        } catch (err) {
          throw new Error(`transform: input is not valid JSON: ${err.message}`)
        }
      } else if (op === 'stringify') {
        try {
          output = JSON.stringify(input)
        } catch (err) {
          throw new Error(`transform: input is not serializable: ${err.message}`)
        }
      } else {
        output = readPath(input, path)
      }

      for (const child of children) {
        await child(ctx, output)
      }
    }
  }
}
