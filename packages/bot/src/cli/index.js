import { readFileSync } from 'node:fs'
import { parseArgs } from './args.js'
import { devCommand } from './dev.js'
import { exportKeysCommand } from './export-keys.js'
import { importKeysCommand } from './import-keys.js'
import { inspectCommand } from './inspect.js'
import { loginCommand } from './login.js'
import { logoutCommand } from './logout.js'
import { registerCommand } from './register.js'
import { runCommand } from './run.js'
import { sandboxCommand } from './sandbox/index.js'
import { tailCommand } from './tail.js'
import { validateCommand } from './validate.js'

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
)
const VERSION = pkg.version
const NAME = pkg.name

/**
 * Distinguishes user errors (exit 1) from internal errors (exit 2).
 */
export class UserError extends Error {
  /** @override */
  name = 'UserError'

  /**
   * @param {string} message - Error description message.
   */
  constructor (message) {
    super(message)
  }
}

/**
 * @typedef {object} Subcommand
 * @property {string} usage - A one-line usage string for the command.
 * @property {string} description - A one-line description for the
 *   command index.
 * @property {(args: string[], flags: Record<string, string | true>,
 *   io: { stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, stdin?: NodeJS.ReadableStream | undefined, cwd?: string | undefined, env?: NodeJS.ProcessEnv | undefined, resolvers?: import('../runtime/keystore/resolvers/index.js').Resolver[] | undefined, logger?: import('../runtime/diagnostics/logger.js').Logger | undefined, fetchImpl?: typeof globalThis.fetch | undefined, runtimeFactory?: typeof import('../runtime/index.js').createRuntime | undefined, commands?: Record<string, Subcommand> | undefined }) => Promise<number>} run - The command's
 *   implementation.
 */

/** @type {Record<string, Subcommand> | null} */
let builtinCommandsCache = null

/**
 * Lazy initializer for builtin commands table to avoid ESM circular initialization TDZ issues.
 *
 * @returns {Record<string, Subcommand>} The builtin commands map.
 */
function getBuiltinCommands () {
  if (!builtinCommandsCache) {
    builtinCommandsCache = {
      validate: validateCommand,
      register: registerCommand,
      login: loginCommand,
      logout: logoutCommand,
      run: runCommand,
      'export-keys': exportKeysCommand,
      'import-keys': importKeysCommand,
      sandbox: sandboxCommand,
      dev: devCommand,
      inspect: inspectCommand,
      tail: tailCommand
    }
  }
  return builtinCommandsCache
}

/**
 * Formats the general CLI help message.
 *
 * @param {Record<string, Subcommand>} commands - Map of subcommand definitions.
 * @returns {string} - Formatted help text string.
 */
function formatGeneralUsage (commands) {
  let lines = 'atoll-bot <command> [options]\n\nCommands:\n'
  for (const [name, cmd] of Object.entries(commands)) {
    const pad = ' '.repeat(Math.max(1, 19 - name.length))
    lines += `  ${name}${pad}${cmd.description}\n`
  }
  lines += '\nOptions:\n  -h, --help         Show this help\n  -v, --version      Show the version\n'
  return lines
}

/**
 * The CLI dispatcher.
 *
 * Parses `argv`, routes to a subcommand, and returns an exit code.
 * Never calls `process.exit`; the caller assigns the returned code to
 * `process.exitCode`.
 *
 * @param {string[]} argv - Arguments after the program name.
 * @param {object} io - Input/output streams and configuration context.
 * @param {NodeJS.WritableStream} io.stdout - Where informational
 *   output goes.
 * @param {NodeJS.WritableStream} io.stderr - Where errors and usage
 *   go.
 * @param {NodeJS.ReadableStream} [io.stdin] - Standard input stream for
 *   subcommands reading stdin.
 * @param {string} [io.cwd] - The working directory for
 *   path resolution. Parameterized for tests.
 * @param {NodeJS.ProcessEnv} [io.env] - Environment variables object.
 *   Parameterized for tests.
 * @param {import('../runtime/keystore/resolvers/index.js').Resolver[]} [io.resolvers] - Keystore
 *   resolvers. Parameterized for tests.
 * @param {import('../runtime/diagnostics/logger.js').Logger} [io.logger] - Logger
 *   instance for diagnostics.
 * @param {typeof globalThis.fetch} [io.fetchImpl] - Fetch implementation.
 * @param {typeof import('../runtime/index.js').createRuntime} [io.runtimeFactory] - Runtime factory implementation.
 * @param {Record<string, Subcommand>} [io.commands] - The subcommand
 *   table. Defaults to the built-in table. Parameterized for tests.
 * @returns {Promise<number>} The exit code: 0, 1, or 2.
 */
export async function dispatch (argv, io) {
  const commands = io.commands ?? getBuiltinCommands()
  const { positional, flags } = parseArgs(argv)
  const subName = positional[0]

  if ((flags.version || flags.v) && !subName) {
    io.stdout.write(`${NAME} ${VERSION}\n`)
    return 0
  }

  if (flags.help || flags.h) {
    if (subName && commands[subName]) {
      io.stdout.write(`${commands[subName].usage}\n`)
      return 0
    }
    io.stdout.write(formatGeneralUsage(commands))
    return 0
  }

  if (!subName) {
    io.stderr.write(formatGeneralUsage(commands))
    return 1
  }

  const command = commands[subName]
  if (!command) {
    io.stderr.write(`unknown command: ${subName}\n`)
    io.stderr.write(formatGeneralUsage(commands))
    return 1
  }

  try {
    const code = await command.run(positional.slice(1), flags, io)
    return typeof code === 'number' ? code : 0
  } catch (err) {
    if (err instanceof UserError) {
      io.stderr.write(`${err.message}\n`)
      return 1
    }
    const msg = err instanceof Error ? err.message : String(err)
    io.stderr.write(`internal error: ${msg}\n`)
    return 2
  }
}
