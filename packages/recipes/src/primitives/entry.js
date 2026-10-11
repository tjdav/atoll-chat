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
 * shape. Called by generated bot.js files.
 *
 * The SDK provides an ArgsReader — an object with a single `get`
 * method. Children downstream use `{{args.name}}` path substitution,
 * which requires a plain object. This function bridges the two: it
 * reads each declared argument from the reader, builds a plain
 * object, and passes that to the primitive's handler.
 *
 * The primitive handler dispatches to its children and returns
 * nothing. The returned CommandDecl handler awaits it and returns
 * `{ type: 'none' }` so the SDK sees a valid CommandResult.
 * @param {string} name - The command name.
 * @param {string | undefined} description - Human-readable
 *   description, or undefined.
 * @param {Record<string, unknown>} argsDecl - Argument declarations,
 *   keyed by argument name.
 * @param {Function} handler - The composed primitive handler from
 *   `exposeCommand.create(...)`.
 * @returns {object} A CommandDecl-shaped object.
 */
export function asCommandDecl (name, description, argsDecl, handler) {
  const declaredArgs = argsDecl ?? {}
  const decl = {
    args: declaredArgs,
    handler: async (ctx, argsReader) => {
      const argsObject = {}
      for (const key of Object.keys(declaredArgs)) {
        argsObject[key] = argsReader.get(key)
      }
      await handler(ctx, { args: argsObject, command: name })
      return { type: 'none' }
    }
  }
  if (description !== undefined) {
    decl.description = description
  }
  return decl
}
