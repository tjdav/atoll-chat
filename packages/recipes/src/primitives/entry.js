// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Public named exports of every primitive, for use by generated
 * bot.js files. Import path: `@atoll/recipes/primitives`.
 */

export { postResponse } from './post-response.js'
export { sendLocal } from './send-local.js'
export { watchPattern } from './watch-pattern.js'
export { keyedStore } from './keyed-store.js'
export { exposeCommand } from './expose-command.js'
export { scheduleTask } from './schedule-task.js'
export { webhookReceive } from './webhook-receive.js'
export { httpFetch } from './http-fetch.js'
export { settingsRead } from './settings-read.js'
export { settingsWrite } from './settings-write.js'
export { transform } from './transform.js'
export { llmComplete } from './llm-complete.js'
export { queueForOperator } from './queue-for-operator.js'

/**
 * Wraps a composed primitive handler in the bot SDK's CommandDecl
 * shape. Called by generated bot.js files. The returned handler
 * dispatches to the underlying primitive with `{ args, command }`
 * and then returns `{ type: 'none' }` so the SDK sees a valid
 * CommandResult.
 * @param {string} name - The command name.
 * @param {string | undefined} description - Human-readable
 *   description, or undefined.
 * @param {object} args - Argument declarations.
 * @param {Function} handler - The composed primitive handler, from
 *   `exposeCommand.create(...)`.
 * @returns {object} A CommandDecl-shaped object.
 */
export function asCommandDecl (name, description, args, handler) {
  const decl = {
    args: args ?? {},
    handler: async (ctx, argsReader) => {
      await handler(ctx, { args: argsReader, command: name })
      return { type: 'none' }
    }
  }
  if (description !== undefined) {
    decl.description = description
  }
  return decl
}
