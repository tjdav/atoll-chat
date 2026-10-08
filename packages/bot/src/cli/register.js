import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineBot } from '../define-bot.js'
import { createKeystore } from '../runtime/keystore/index.js'
import { createHttpClient } from '../runtime/transport/http.js'
import { UserError } from './index.js'
import { generateBotKeyMaterial } from './keygen.js'

/**
 * Converts a Uint8Array to a base64url string.
 *
 * @param {Uint8Array} bytes - Input bytes.
 * @returns {string} Base64url encoded string.
 */
function base64url (bytes) {
  return Buffer.from(bytes).toString('base64url')
}

/**
 * The `register` subcommand.
 *
 * Loads a bot file, generates fresh key material, calls POST /bots,
 * and writes a keystore file containing the private keys, the bot
 * token, and the operator session.
 *
 * @type {import('./index.js').Subcommand}
 */
export const registerCommand = {
  usage: 'atoll-bot register <path> [--force]',
  description: 'Register a new bot account and write the keystore',
  async run (args, flags, io) {
    if (args.length === 0 || !args[0]) {
      throw new UserError('register requires a path to a bot file')
    }

    const inputPath = args[0]
    const cwd = io.cwd ?? process.cwd()
    const resolvedPath = resolve(cwd, inputPath)

    try {
      statSync(resolvedPath)
    } catch {
      throw new UserError(`${inputPath}: file not found`)
    }

    const env = io.env ?? process.env

    if (!env.ATOL_SERVER_URL) {
      throw new UserError('register requires ATOL_SERVER_URL')
    }
    if (!env.ATOL_USER_TOKEN) {
      throw new UserError('register requires ATOL_USER_TOKEN (operator session)')
    }
    if (!env.ATOL_BOT_KEYSTORE_SECRET) {
      throw new UserError('register requires ATOL_BOT_KEYSTORE_SECRET')
    }

    const keystorePath = env.ATOL_BOT_KEYSTORE
      ? resolve(cwd, env.ATOL_BOT_KEYSTORE)
      : resolve(cwd, 'bot.keystore')

    let keystoreExists = false
    try {
      statSync(keystorePath)
      keystoreExists = true
    } catch {
      keystoreExists = false
    }

    if (keystoreExists && !flags.force && !flags.f) {
      throw new UserError(`${keystorePath}: keystore already exists; pass --force to overwrite`)
    }

    let mod
    try {
      mod = await import(pathToFileURL(resolvedPath).href)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new UserError(`${inputPath}: failed to load: ${msg}`)
    }

    const bot = mod?.default
    if (!bot || typeof bot !== 'object' || !bot.config || typeof bot.config !== 'object' || typeof bot.config.id !== 'string') {
      throw new UserError(`${inputPath}: default export is not a Bot`)
    }

    try {
      defineBot(bot.config)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new UserError(`validation failed:\n${msg}`)
    }

    const material = generateBotKeyMaterial()

    const reqBody = {
      display_name: bot.config.label ?? bot.config.id,
      bot_identity_pubkey: base64url(material.publicKeys.botIdentity),
      bot_command_pubkey: base64url(material.publicKeys.botCommand),
      identity_pubkey: base64url(material.publicKeys.identity),
      declared_scopes: bot.config.capabilities
    }

    const client = createHttpClient({
      serverUrl: env.ATOL_SERVER_URL,
      botToken: env.ATOL_USER_TOKEN,
      logger: io.logger,
      fetchImpl: io.fetchImpl
    })

    let res
    try {
      res = await client.request('POST', '/api/v1/bots', {
        body: reqBody,
        retry: false
      })
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
        const errCode = 'responseErrorCode' in err && err.responseErrorCode ? ` ${err.responseErrorCode}` : ''
        throw new UserError(`register failed: ${err.status}${errCode}`)
      }
      const msg = err instanceof Error ? err.message : String(err)
      throw new UserError(`register failed: ${msg}`)
    }

    const body = /** @type {Record<string, any>} */ (res.body && typeof res.body === 'object' ? res.body : {})

    let botId = null
    if (typeof body.bot_id === 'string') {
      botId = body.bot_id
    } else if (typeof body.bot === 'object' && body.bot !== null && typeof body.bot.id === 'string') {
      botId = body.bot.id
    }

    let botToken = null
    if (typeof body.bot_token === 'string') {
      botToken = body.bot_token
    } else if (typeof body.token === 'string') {
      botToken = body.token
    }

    if (!botId || !botToken) {
      throw new UserError('register failed: response did not include bot_id/bot_token')
    }

    const now = new Date().toISOString()
    const plaintext = {
      version: 1,
      bot_id: botId,
      bot_token: botToken,
      bot_identity_private: base64url(material.privateKeys.botIdentity),
      bot_command_private: base64url(material.privateKeys.botCommand),
      identity_private: base64url(material.privateKeys.identity),
      storage_seed: base64url(material.storageSeed),
      operator_session: env.ATOL_USER_TOKEN,
      created_at: now,
      rotated_at: now
    }

    await createKeystore({
      path: keystorePath,
      secret: env.ATOL_BOT_KEYSTORE_SECRET,
      data: plaintext
    })

    io.stdout.write(`Registered bot ${botId}.\n`)
    io.stdout.write(`Keystore written to ${keystorePath}.\n`)
    io.stdout.write('Operator session cached.\n')

    return 0
  }
}
