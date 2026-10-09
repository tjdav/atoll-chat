// SPDX-License-Identifier: AGPL-3.0-or-later

const COMMAND_NAME = /^[a-z][a-z0-9-]*$/

/**
 * expose-command registers a slash command with the runtime. When a
 * user invokes the command, the primitive calls each child handler
 * with the command's arguments and name.
 *
 * This is the second composite primitive. It follows the same
 * contract as watch-pattern: create receives resolved children, and
 * the handler it returns invokes them with a payload.
 * @type {Primitive}
 */
export const exposeCommand = {
  id: 'expose-command',
  targets: ['bot'],
  capabilities: ['read_commands'],
  label: 'Expose Command',
  description: 'Registers a slash command and dispatches to children on invocation.',
  configSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, pattern: '^[a-z][a-z0-9-]*$' },
      description: { type: 'string' },
      args: { type: 'object' }
    },
    required: ['name'],
    additionalProperties: false
  },
  create: (config, children) => {
    const name = config.name
    const description = config.description
    const args = config.args

    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('expose-command: config.name is required')
    }
    if (!COMMAND_NAME.test(name)) {
      throw new Error(
        'expose-command: config.name must match ^[a-z][a-z0-9-]*$'
      )
    }
    if (description !== undefined && typeof description !== 'string') {
      throw new Error('expose-command: config.description must be a string')
    }
    if (args !== undefined) {
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        throw new Error('expose-command: config.args must be a plain object')
      }
    }
    if (!Array.isArray(children)) {
      throw new Error('expose-command: children must be an array')
    }
    if (children.length === 0) {
      throw new Error('expose-command: at least one child is required')
    }

    return async (ctx, input) => {
      const args = input && typeof input === 'object' ? input.args : undefined
      if (!args || typeof args.get !== 'function') {
        return
      }
      const payload = { args, command: name }
      for (const child of children) {
        await child(ctx, payload)
      }
    }
  }
}
