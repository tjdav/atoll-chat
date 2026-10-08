import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineBot } from '../define-bot.js'
import { loadConfig } from '../runtime/config/index.js'
import { createLogger } from '../runtime/diagnostics/logger.js'
import { Keystore } from '../runtime/keystore/index.js'
import { envResolver } from '../runtime/keystore/resolvers/env.js'
import { keychainResolver } from '../runtime/keystore/resolvers/keychain.js'
import { promptResolver } from '../runtime/keystore/resolvers/prompt.js'
import { createRuntime } from '../runtime/index.js'
import { installSignalHandlers, runShutdownSequence } from '../runtime/shutdown.js'
import { ValidationError, KeystoreLockedError, KeystoreCorruptError } from '../errors.js'
import { UserError } from './index.js'

/**
 * Determines whether an error during runtime.start() is user-actionable.
 *
 * @param {unknown} err - Error thrown by runtime.start().
 * @returns {boolean} True if user-actionable (exit code 1).
 */
function isUserActionable (err) {
  if (err == null || typeof err !== 'object') {
    return false
  }
  if (err instanceof ValidationError) {
    return true
  }
  if (err instanceof KeystoreLockedError) {
    return true
  }
  if (err instanceof KeystoreCorruptError) {
    return true
  }
  if (typeof /** @type {any} */ (err).code === 'string') {
    const code = /** @type {any} */ (err).code
    if (
      code.startsWith('config_') ||
      code.startsWith('keystore_') ||
      code.startsWith('http_request_')
    ) {
      return true
    }
  }
  const msg = String(/** @type {any} */ (err).message ?? '')
  if (msg.includes('ECONNREFUSED')) {
    return true
  }
  if (msg.includes('ENOTFOUND')) {
    return true
  }
  if (msg.includes('EADDRINUSE')) {
    return true
  }
  return false
}

/**
 * The `run` subcommand.
 *
 * Loads the bot file and config, opens the keystore, constructs the
 * runtime, starts it, and blocks until a signal arrives. On signal,
 * runs the graceful shutdown sequence and returns its exit code.
 *
 * @type {import('./index.js').Subcommand}
 */
export const runCommand = {
  usage: 'atoll-bot run <path>',
  description: 'Run the bot against the configured server',
  async run (args, flags, io) {
    if (args.length === 0 || !args[0]) {
      throw new UserError('run requires a path to a bot file')
    }

    const inputPath = args[0]
    const cwd = io.cwd ?? process.cwd()
    const resolvedPath = resolve(cwd, inputPath)

    try {
      statSync(resolvedPath)
    } catch {
      throw new UserError(`${inputPath}: file not found`)
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

    const env = io.env ?? process.env
    let config
    try {
      config = await loadConfig({ env, cwd })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new UserError(msg)
    }

    try {
      statSync(config.keystorePath)
    } catch {
      throw new UserError(`${inputPath}: keystore not found; run atoll-bot register first`)
    }

    const resolvers = io.resolvers ?? [
      envResolver('ATOL_BOT_KEYSTORE_SECRET', env),
      keychainResolver(),
      promptResolver()
    ]

    const keystore = new Keystore({ path: config.keystorePath, resolvers })
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

    const logger = io.logger ?? createLogger({
      botId: bot.config.id,
      level: config.runtime.logLevel,
      sink: (line) => {
        io.stderr.write(line)
      },
      dev: false
    })

    const factory = io.runtimeFactory ?? createRuntime
    const runtime = factory({
      bot,
      config,
      keystoreData,
      logger
    })

    io.stdout.write(`Starting bot ${bot.config.id}.\n`)
    io.stdout.write(`Keystore: ${config.keystorePath}\n`)

    const triggersList = bot.config.triggers ?? []
    const hasWebhookTrigger = Array.isArray(triggersList) && triggersList.some((t) => t && t.type === 'webhook')
    if (config.webhook && typeof config.webhook.port === 'number' && config.webhook.port > 0 && hasWebhookTrigger) {
      const host = config.webhook.host ?? '127.0.0.1'
      const port = config.webhook.port
      const basePath = config.webhook.basePath ?? ''
      io.stdout.write(`Webhooks: http://${host}:${port}${basePath}\n`)
    }

    /** @type {(code: number) => void} */
    let resolveExit = () => {}
    /** @type {Promise<number>} */
    const exitPromise = new Promise((resolve) => {
      resolveExit = resolve
    })

    const cleanupSignals = installSignalHandlers({
      onSignal: async () => {
        logger.info('signal received, shutting down')
        const code = await runShutdownSequence({
          runtime,
          drainMs: config.shutdown.drainMs,
          logger
        })
        resolveExit(code)
      },
      logger
    })

    try {
      await runtime.start()
    } catch (err) {
      cleanupSignals()
      if (isUserActionable(err)) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new UserError(msg)
      }
      throw err
    }

    io.stdout.write('Ready. Press Ctrl+C to stop.\n')

    const exitCode = await exitPromise
    cleanupSignals()
    return exitCode
  }
}
