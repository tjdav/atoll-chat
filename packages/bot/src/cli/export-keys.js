import fs from 'node:fs'
import { resolve } from 'node:path'
import { validateOuter } from '../runtime/keystore/schema.js'
import { UserError } from './index.js'

/**
 * Resolves the keystore file path from the environment or default location.
 *
 * @param {object} io - I/O context containing environment and working directory.
 * @param {NodeJS.ProcessEnv} [io.env] - Environment variables object.
 * @param {string} [io.cwd] - Current working directory.
 * @returns {string} Absolute path to the keystore file.
 */
function resolveKeystorePath (io) {
  const env = io.env ?? process.env
  const cwd = io.cwd ?? process.cwd()
  return env.ATOL_BOT_KEYSTORE
    ? resolve(cwd, env.ATOL_BOT_KEYSTORE)
    : resolve(cwd, 'bot.keystore')
}

/**
 * The `export-keys` subcommand.
 *
 * Writes the encrypted keystore file to `--out <path>`, or to stdout
 * when `--out` is omitted. Does not decrypt the file. Does not require
 * the passphrase.
 *
 * @type {import('./index.js').Subcommand}
 */
export const exportKeysCommand = {
  usage: 'atoll-bot export-keys [--out <path>]',
  description: 'Write the encrypted keystore to a destination',
  async run (args, flags, io) {
    const keystorePath = resolveKeystorePath(io)

    if (!fs.existsSync(keystorePath)) {
      throw new UserError(`${keystorePath}: keystore not found`)
    }

    /** @type {Buffer} */
    let bytes
    try {
      bytes = await fs.promises.readFile(keystorePath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new UserError(`${keystorePath}: cannot read: ${msg}`)
    }

    /** @type {unknown} */
    let parsed
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch {
      throw new UserError(`${keystorePath}: not valid JSON`)
    }

    const validation = validateOuter(parsed)
    if (!validation.ok) {
      throw new UserError(`${keystorePath}: malformed keystore: ${validation.reason}`)
    }

    const cwd = io.cwd ?? process.cwd()
    const outOption = flags.out ?? flags.o

    if (typeof outOption === 'string' && outOption.length > 0) {
      const outPath = resolve(cwd, outOption)
      if (fs.existsSync(outPath) && flags.force !== true && flags.f !== true) {
        throw new UserError(`${outPath}: destination already exists; pass --force to overwrite`)
      }

      try {
        await fs.promises.writeFile(outPath, bytes, { mode: 0o600 })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new UserError(`${outPath}: cannot write: ${msg}`)
      }

      io.stdout.write(`Exported keystore to ${outPath}.\n`)
    } else {
      io.stdout.write(bytes)
      io.stderr.write(`Exported ${bytes.length} bytes to stdout.\n`)
    }

    return 0
  }
}
