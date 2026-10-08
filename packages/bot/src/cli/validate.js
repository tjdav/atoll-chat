import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineBot } from '../define-bot.js'
import { UserError } from './index.js'

/**
 * The `validate` subcommand.
 *
 * Loads a bot file, checks that it exports a `Bot`, re-validates the
 * configuration via `defineBot`, and reports the result.
 *
 * @type {import('./index.js').Subcommand}
 */
export const validateCommand = {
  usage: 'atoll-bot validate <path>',
  description: 'Validate a bot file without connecting',
  async run (args, flags, io) {
    if (args.length === 0 || !args[0]) {
      throw new UserError('validate requires a path to a bot file')
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
      if (err && typeof err === 'object' && 'code' in err && err.code === 'validation_error') {
        const msg = 'message' in err && typeof err.message === 'string' ? err.message : String(err)
        throw new UserError(`validation failed:\n${msg}`)
      }
      throw err
    }

    const label = bot.config.label ?? bot.config.id
    io.stdout.write(`OK: ${bot.config.id} (${label})\n`)
    return 0
  }
}
