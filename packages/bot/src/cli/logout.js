import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { KeystoreLockedError, KeystoreCorruptError } from '../errors.js'
import { Keystore } from '../runtime/keystore/index.js'
import { envResolver } from '../runtime/keystore/resolvers/env.js'
import { keychainResolver } from '../runtime/keystore/resolvers/keychain.js'
import { promptResolver } from '../runtime/keystore/resolvers/prompt.js'
import { UserError } from './index.js'

/**
 * The `logout` subcommand.
 *
 * Clears the operator session from the keystore.
 *
 * @type {import('./index.js').Subcommand}
 */
export const logoutCommand = {
  usage: 'atoll-bot logout',
  description: 'Clear the cached operator session',
  async run (args, flags, io) {
    const env = io.env ?? process.env
    const cwd = io.cwd ?? process.cwd()

    const keystorePath = env.ATOL_BOT_KEYSTORE
      ? resolve(cwd, env.ATOL_BOT_KEYSTORE)
      : resolve(cwd, 'bot.keystore')

    try {
      statSync(keystorePath)
    } catch {
      throw new UserError(`${keystorePath}: keystore not found`)
    }

    const resolvers = io.resolvers ?? [
      envResolver('ATOL_BOT_KEYSTORE_SECRET', env),
      keychainResolver(),
      promptResolver()
    ]

    const keystore = new Keystore({
      path: keystorePath,
      resolvers
    })

    /** @type {Record<string, unknown>} */
    let plaintext
    try {
      plaintext = /** @type {Record<string, unknown>} */ (await keystore.load())
    } catch (err) {
      if (err instanceof KeystoreLockedError || err instanceof KeystoreCorruptError) {
        throw new UserError(err.message)
      }
      throw err
    }

    delete plaintext.operator_session

    try {
      await keystore.save(plaintext)
    } catch (err) {
      if (err instanceof KeystoreLockedError || err instanceof KeystoreCorruptError) {
        throw new UserError(err.message)
      }
      throw err
    }

    io.stdout.write('Operator session cleared.\n')
    return 0
  }
}
