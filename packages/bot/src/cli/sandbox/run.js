import { statSync } from 'node:fs'
import { KeystoreLockedError, KeystoreCorruptError } from '../../errors.js'
import { Keystore } from '../../runtime/keystore/index.js'
import { envResolver } from '../../runtime/keystore/resolvers/env.js'
import { keychainResolver } from '../../runtime/keystore/resolvers/keychain.js'
import { promptResolver } from '../../runtime/keystore/resolvers/prompt.js'
import { UserError } from '../index.js'
import { runCommand as prodRunCommand } from '../run.js'
import { resolveSandboxKeystorePath } from './index.js'

/**
 * The `sandbox run` sub-subcommand.
 *
 * Runs the bot against the sandbox server using the sandbox keystore.
 *
 * @type {import('../index.js').Subcommand}
 */
export const runCommand = {
  usage: 'atoll-bot sandbox run <path>',
  description: 'Run the bot against the sandbox server',
  async run (args, flags, io) {
    if (args.length === 0 || !args[0]) {
      throw new UserError('sandbox run requires a path to a bot file')
    }

    const sandboxKeystorePath = resolveSandboxKeystorePath(io)

    try {
      statSync(sandboxKeystorePath)
    } catch {
      throw new UserError(`${sandboxKeystorePath}: sandbox keystore not found; run atoll-bot sandbox connect first`)
    }

    const env = io.env ?? process.env
    const resolvers = io.resolvers ?? [
      envResolver('ATOL_BOT_KEYSTORE_SECRET', env),
      keychainResolver(),
      promptResolver()
    ]

    const keystore = new Keystore({
      path: sandboxKeystorePath,
      resolvers
    })
    /** @type {Record<string, any>} */
    let keystoreData
    try {
      keystoreData = await keystore.load()
    } catch (err) {
      if (err instanceof KeystoreLockedError) {
        throw new UserError(`keystore locked: ${err.message}`)
      }
      if (err instanceof KeystoreCorruptError) {
        throw new UserError(`keystore corrupt: ${err.message}`)
      }
      const msg = err instanceof Error ? err.message : String(err)
      throw new UserError(msg)
    }

    const sandboxUrl = keystoreData?.sandbox_url
    if (!sandboxUrl || typeof sandboxUrl !== 'string') {
      throw new UserError('sandbox keystore is missing sandbox_url; re-run sandbox connect')
    }

    const childEnv = {
      ...(io.env ?? process.env),
      ATOL_SERVER_URL: sandboxUrl,
      ATOL_BOT_KEYSTORE: sandboxKeystorePath
    }

    const childIO = {
      ...io,
      env: childEnv
    }

    return prodRunCommand.run(args, flags, childIO)
  }
}
