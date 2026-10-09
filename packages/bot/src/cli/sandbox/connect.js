import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineBot } from '../../define-bot.js'
import { createKeystore } from '../../runtime/keystore/index.js'
import { createHttpClient } from '../../runtime/transport/http.js'
import { UserError } from '../index.js'
import { generateBotKeyMaterial } from '../keygen.js'
import { resolveSandboxKeystorePath } from './index.js'

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
 * The `sandbox connect` sub-subcommand.
 *
 * Registers a bot against a sandbox server and writes a sandbox
 * keystore.
 *
 * @type {import('../index.js').Subcommand}
 */
export const connectCommand = {
  usage: 'atoll-bot sandbox connect <url> --token <token>',
  description: 'Register a sandbox bot and write its keystore',
  async run (args, flags, io) {
    if (args.length === 0 || !args[0]) {
      throw new UserError('sandbox connect requires a URL')
    }

    const rawUrl = args[0]
    let parsedUrl
    try {
      parsedUrl = new URL(rawUrl)
    } catch {
      throw new UserError(`${rawUrl}: not a valid http(s) URL`)
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new UserError(`${rawUrl}: not a valid http(s) URL`)
    }

    const url = (parsedUrl.origin + parsedUrl.pathname).replace(/\/+$/, '')

    const env = io.env ?? process.env

    const token = typeof flags.token === 'string' && flags.token.trim() !== ''
      ? flags.token
      : env.ATOL_SANDBOX_TOKEN

    if (!token) {
      throw new UserError('sandbox connect requires --token or ATOL_SANDBOX_TOKEN')
    }

    if (!env.ATOL_BOT_KEYSTORE_SECRET) {
      throw new UserError('sandbox connect requires ATOL_BOT_KEYSTORE_SECRET')
    }

    const botArg = typeof flags.bot === 'string' && flags.bot.trim() !== ''
      ? flags.bot
      : args[1]

    if (!botArg) {
      throw new UserError('sandbox connect requires a bot file path (--bot <path> or second positional)')
    }

    const cwd = io.cwd ?? process.cwd()
    const resolvedBotPath = resolve(cwd, botArg)

    try {
      statSync(resolvedBotPath)
    } catch {
      throw new UserError(`${botArg}: file not found`)
    }

    let mod
    try {
      mod = await import(pathToFileURL(resolvedBotPath).href)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new UserError(`${botArg}: failed to load: ${msg}`)
    }

    const bot = mod?.default
    if (!bot || typeof bot !== 'object' || !bot.config || typeof bot.config !== 'object' || typeof bot.config.id !== 'string') {
      throw new UserError(`${botArg}: default export is not a Bot`)
    }

    try {
      defineBot(bot.config)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new UserError(`validation failed:\n${msg}`)
    }

    const keystorePath = resolveSandboxKeystorePath(io)

    let keystoreExists = false
    try {
      statSync(keystorePath)
      keystoreExists = true
    } catch {
      keystoreExists = false
    }

    if (keystoreExists && flags.force !== true && flags.f !== true) {
      throw new UserError(`${keystorePath}: sandbox keystore already exists; pass --force to overwrite`)
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
      serverUrl: url,
      botToken: token,
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
        throw new UserError(`sandbox connect failed: ${err.status}${errCode}`)
      }
      const msg = err instanceof Error ? err.message : String(err)
      throw new UserError(`sandbox connect failed: ${msg}`)
    }

    /** @type {Record<string, any>} */
    const body = res.body && typeof res.body === 'object' ? res.body : {}

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
      throw new UserError('sandbox connect failed: response did not include bot_id/bot_token')
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
      operator_session: undefined,
      sandbox_url: url,
      created_at: now,
      rotated_at: now
    }

    await createKeystore({
      path: keystorePath,
      secret: env.ATOL_BOT_KEYSTORE_SECRET,
      data: plaintext
    })

    io.stdout.write(`Sandbox bot registered: ${botId}\n`)
    io.stdout.write(`Keystore written to ${keystorePath}\n`)
    io.stdout.write(`Server: ${url}\n`)

    return 0
  }
}
