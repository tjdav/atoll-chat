import { statSync, writeFileSync, appendFileSync, watch } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
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
import { createMockServer } from '../testing/mock-server.js'
import { generateBotKeyMaterial } from './keygen.js'
import { resolveDiagPath } from './diag-file.js'
import { UserError } from './index.js'

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
 * The `dev` subcommand.
 *
 * Runs the bot against a local mock server with verbose logging and
 * hot reload. Re-imports the bot file on change and restarts the
 * runtime. Runs until a signal arrives.
 *
 * @type {import('./index.js').Subcommand}
 */
export const devCommand = {
  usage: 'atoll-bot dev <path>',
  description: 'Run the bot locally with hot reload and a mock server',
  async run (args, flags, io) {
    if (args.length === 0 || !args[0]) {
      throw new UserError('dev requires a path to a bot file')
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
    let loadedConfig
    try {
      loadedConfig = await loadConfig({ env, cwd })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new UserError(msg)
    }

    const mockServer = await createMockServer({ validateCrypto: false })
    const config = {
      ...loadedConfig,
      serverUrl: mockServer.getUrl()
    }
    io.stdout.write(`Mock server listening at ${mockServer.getUrl()}\n`)

    let keystoreData
    let keystoreExists = false
    try {
      statSync(config.keystorePath)
      keystoreExists = true
    } catch {
      keystoreExists = false
    }

    if (!keystoreExists) {
      io.stdout.write(`Dev mode: no keystore found at ${config.keystorePath}, using synthetic keys.\n`)
      const material = generateBotKeyMaterial()
      const now = new Date().toISOString()
      keystoreData = {
        version: 1,
        bot_id: 'b_synthetic_dev',
        bot_token: 'bot_token_dev_synthetic',
        bot_identity_private: base64url(material.privateKeys.botIdentity),
        bot_command_private: base64url(material.privateKeys.botCommand),
        identity_private: base64url(material.privateKeys.identity),
        storage_seed: base64url(material.storageSeed),
        operator_session: 'dev_session',
        created_at: now,
        rotated_at: now
      }
    } else {
      const resolvers = io.resolvers ?? [
        envResolver('ATOL_BOT_KEYSTORE_SECRET', env),
        keychainResolver(),
        promptResolver()
      ]
      const keystore = new Keystore({ path: config.keystorePath, resolvers })
      try {
        keystoreData = await keystore.load()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await mockServer.close()
        throw new UserError(msg)
      }
    }

    const diagPath = resolveDiagPath(config.keystorePath)

    /**
     * Helper to load the bot module and validate it.
     *
     * @param {string} filePath - Resolved file path.
     * @returns {Promise<any>} The validated bot object.
     */
    async function loadBotModule (filePath) {
      const cacheBuster = `?t=${Date.now()}`
      const mod = await import(pathToFileURL(filePath).href + cacheBuster)
      const botObj = mod?.default
      if (!botObj || typeof botObj !== 'object' || !botObj.config || typeof botObj.config !== 'object' || typeof botObj.config.id !== 'string') {
        throw new UserError(`${inputPath}: default export is not a Bot`)
      }
      defineBot(botObj.config)
      return botObj
    }

    let currentBot
    try {
      currentBot = await loadBotModule(resolvedPath)
    } catch (err) {
      await mockServer.close()
      const msg = err instanceof Error ? err.message : String(err)
      throw new UserError(msg)
    }

    /**
     * Writes the state placeholder snapshot to the diagnostic file.
     *
     * @param {string} botId - The bot ID.
     */
    function writeStateLine (botId) {
      const nowISO = new Date().toISOString()
      const stateObj = {
        type: 'state',
        at: nowISO,
        data: {
          bot_id: botId,
          now: nowISO,
          grants: {},
          publisher_keys: {},
          settings: {},
          storage: {},
          mode: 'dev'
        }
      }
      try {
        writeFileSync(diagPath, JSON.stringify(stateObj) + '\n')
      } catch {}
    }

    writeStateLine(currentBot.config.id)

    const logger = io.logger ?? createLogger({
      botId: currentBot.config.id,
      level: 'debug',
      sink: (line) => {
        io.stdout.write(line)
        try {
          appendFileSync(diagPath, line)
        } catch {}
      },
      dev: true
    })

    const factory = io.runtimeFactory ?? createRuntime
    let activeRuntime = factory({
      bot: currentBot,
      config,
      keystoreData,
      logger
    })

    await activeRuntime.start()

    /** @type {NodeJS.Timeout | null} */
    let debounceTimer = null
    const targetBaseName = basename(resolvedPath)
    const targetDir = dirname(resolvedPath)

    let fsWatcher = null
    try {
      fsWatcher = watch(targetDir, (eventType, filename) => {
        if (!fsWatcher) {
          return
        }
        if (!filename || filename === targetBaseName) {
          if (debounceTimer) {
            clearTimeout(debounceTimer)
          }
          debounceTimer = setTimeout(async () => {
            debounceTimer = null
            if (!fsWatcher) {
              return
            }
            try {
              if (activeRuntime) {
                await activeRuntime.stop({ drainMs: 2000 })
              }
              const reloadedBot = await loadBotModule(resolvedPath)
              currentBot = reloadedBot
              activeRuntime = factory({
                bot: currentBot,
                config,
                keystoreData,
                logger
              })
              await activeRuntime.start()
              writeStateLine(currentBot.config.id)
              io.stdout.write('Reloaded.\n')
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              io.stderr.write(`reload failed: ${msg}\n`)
            }
          }, 200)
        }
      })
    } catch {}

    /** @type {(code: number) => void} */
    let resolveExit = () => {}
    /** @type {Promise<number>} */
    const exitPromise = new Promise((resolve) => {
      resolveExit = resolve
    })

    const cleanupSignals = installSignalHandlers({
      onSignal: async () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer)
          debounceTimer = null
        }
        if (fsWatcher) {
          fsWatcher.close()
          fsWatcher = null
        }
        let code = 0
        if (activeRuntime) {
          const res = await runShutdownSequence({
            runtime: activeRuntime,
            drainMs: config.shutdown.drainMs,
            logger
          })
          code = res
        }
        await mockServer.close()
        resolveExit(code)
      },
      logger: io.logger
    })

    const exitCode = await exitPromise
    cleanupSignals()
    return exitCode
  }
}
