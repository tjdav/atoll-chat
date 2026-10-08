import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { KeystoreLockedError, KeystoreCorruptError } from '../errors.js'
import { Keystore } from '../runtime/keystore/index.js'
import { envResolver } from '../runtime/keystore/resolvers/env.js'
import { keychainResolver } from '../runtime/keystore/resolvers/keychain.js'
import { promptResolver } from '../runtime/keystore/resolvers/prompt.js'
import { UserError } from './index.js'

/**
 * The `login` subcommand.
 *
 * Updates the operator session cached in the keystore. The new session
 * comes from the `--token` flag or `ATOL_USER_TOKEN`.
 *
 * @type {import('./index.js').Subcommand}
 */
export const loginCommand = {
  usage: 'atoll-bot login [--token <value>]',
  description: 'Cache an operator session in the keystore',
  async run (args, flags, io) {
    const env = io.env ?? process.env

    let token = null
    if (typeof flags.token === 'string' && flags.token.length > 0) {
      token = flags.token
    } else if (typeof flags.t === 'string' && flags.t.length > 0) {
      token = flags.t
    } else if (typeof env.ATOL_USER_TOKEN === 'string' && env.ATOL_USER_TOKEN.length > 0) {
      token = env.ATOL_USER_TOKEN
    }

    if (!token) {
      throw new UserError('login requires --token or ATOL_USER_TOKEN')
    }

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

    plaintext.operator_session = token

    try {
      await keystore.save(plaintext)
    } catch (err) {
      if (err instanceof KeystoreLockedError || err instanceof KeystoreCorruptError) {
        throw new UserError(err.message)
      }
      throw err
    }

    io.stdout.write('Operator session cached.\n')
    return 0
  }
}
