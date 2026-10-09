import { statSync, unlinkSync } from 'node:fs'
import { KeystoreLockedError, KeystoreCorruptError } from '../../errors.js'
import { Keystore } from '../../runtime/keystore/index.js'
import { envResolver } from '../../runtime/keystore/resolvers/env.js'
import { keychainResolver } from '../../runtime/keystore/resolvers/keychain.js'
import { promptResolver } from '../../runtime/keystore/resolvers/prompt.js'
import { createHttpClient } from '../../runtime/transport/http.js'
import { UserError } from '../index.js'
import { resolveSandboxKeystorePath } from './index.js'

/**
 * The `sandbox reset` sub-subcommand.
 *
 * Deletes the sandbox bot from the server and removes the local
 * keystore.
 *
 * @type {import('../index.js').Subcommand}
 */
export const resetCommand = {
  usage: 'atoll-bot sandbox reset [--keep-local] [--keep-remote]',
  description: 'Delete the sandbox bot and its keystore',
  async run (args, flags, io) {
    const sandboxKeystorePath = resolveSandboxKeystorePath(io)

    try {
      statSync(sandboxKeystorePath)
    } catch {
      throw new UserError(`${sandboxKeystorePath}: sandbox keystore not found`)
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

    const sandboxUrl = keystoreData.sandbox_url
    const botId = keystoreData.bot_id
    const botToken = keystoreData.bot_token

    if (!sandboxUrl || !botId || !botToken) {
      throw new UserError('sandbox reset failed: keystore is missing sandbox_url, bot_id, or bot_token')
    }

    if (!flags['keep-remote']) {
      const client = createHttpClient({
        serverUrl: sandboxUrl,
        botToken,
        logger: io.logger,
        fetchImpl: io.fetchImpl
      })

      try {
        await client.request('DELETE', `/api/v1/bots/${botId}`, { retry: false })
      } catch (err) {
        const status = err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
          ? err.status
          : null
        if (status === 404) {
          // Treated as success
        } else if (status !== null) {
          throw new UserError(`sandbox reset failed: ${status}`)
        } else {
          const msg = err instanceof Error ? err.message : String(err)
          throw new UserError(`sandbox reset failed: ${msg}`)
        }
      }
    }

    if (!flags['keep-local']) {
      unlinkSync(sandboxKeystorePath)
    }

    io.stdout.write(`Sandbox bot ${botId} deleted.\n`)
    if (flags['keep-local']) {
      io.stdout.write(`Sandbox keystore kept: ${sandboxKeystorePath}\n`)
    } else {
      io.stdout.write(`Sandbox keystore removed: ${sandboxKeystorePath}\n`)
    }

    return 0
  }
}
