import { resolve } from 'node:path'
import { UserError } from '../index.js'
import { connectCommand } from './connect.js'
import { resetCommand } from './reset.js'
import { runCommand } from './run.js'

/**
 * Resolves the sandbox keystore path from the environment or the default.
 *
 * @param {object} io - Input/output and environment context.
 * @param {NodeJS.ProcessEnv} [io.env] - Environment variables object.
 * @param {string} [io.cwd] - Current working directory.
 * @returns {string} The absolute sandbox keystore path.
 */
export function resolveSandboxKeystorePath (io) {
  const cwd = io.cwd ?? process.cwd()
  const env = io.env ?? process.env
  if (env.ATOL_BOT_SANDBOX_KEYSTORE) {
    return resolve(cwd, env.ATOL_BOT_SANDBOX_KEYSTORE)
  }
  return resolve(cwd, 'bot.keystore.sandbox')
}

/**
 * The `sandbox` subcommand.
 *
 * A dispatcher for sandbox-related sub-subcommands. The first
 * positional argument is the sub-subcommand name.
 *
 * @type {import('../index.js').Subcommand}
 */
export const sandboxCommand = {
  usage: 'atoll-bot sandbox <connect|run|reset> [args] [--flags]',
  description: 'Manage a sandbox bot against an isolated server',
  async run (args, flags, io) {
    if (args.length === 0 || !args[0]) {
      throw new UserError('sandbox requires a subcommand: connect, run, or reset')
    }

    const subName = args[0]
    if (subName === 'connect') {
      return connectCommand.run(args.slice(1), flags, io)
    }
    if (subName === 'run') {
      return runCommand.run(args.slice(1), flags, io)
    }
    if (subName === 'reset') {
      return resetCommand.run(args.slice(1), flags, io)
    }

    throw new UserError(`unknown sandbox subcommand: ${subName}`)
  }
}
