import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { installSignalHandlers } from '../runtime/shutdown.js'
import { followDiagFile, resolveDiagPath } from './diag-file.js'
import { UserError } from './index.js'

/**
 * The `tail` subcommand.
 *
 * Follows the diagnostic file and prints new log lines. Runs until a
 * signal arrives or the file is deleted.
 *
 * @type {import('./index.js').Subcommand}
 */
export const tailCommand = {
  usage: 'atoll-bot tail [--from-start]',
  description: 'Live-stream the running bot\'s logs',
  async run (args, flags, io) {
    const env = io.env ?? process.env
    const cwd = io.cwd ?? process.cwd()

    const keystorePath = env.ATOL_BOT_KEYSTORE
      ? resolve(cwd, env.ATOL_BOT_KEYSTORE)
      : resolve(cwd, 'bot.keystore')

    const diagPath = resolveDiagPath(keystorePath)

    try {
      statSync(diagPath)
    } catch {
      throw new UserError(`${diagPath}: diagnostic file not found; is the bot running?`)
    }

    /** @type {() => void} */
    let resolveWait = () => {}
    /** @type {Promise<void>} */
    const waitPromise = new Promise((resolve) => {
      resolveWait = resolve
    })

    const cleanupSignals = installSignalHandlers({
      onSignal: async () => {
        resolveWait()
      },
      logger: io.logger
    })

    const fromStart = flags['from-start'] === true

    const stopFollower = await followDiagFile({
      path: diagPath,
      fromStart,
      onLine: (line) => {
        io.stdout.write(JSON.stringify(line) + '\n')
      },
      onError: (err) => {
        io.stderr.write(`warning: ${err.message}\n`)
      }
    })

    await waitPromise

    stopFollower()
    cleanupSignals()

    return 0
  }
}
