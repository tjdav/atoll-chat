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
 * Reads all bytes from a readable stream into a Buffer.
 *
 * @param {any} stream - Input stream.
 * @returns {Promise<Buffer>} Concatenated Buffer of bytes.
 */
async function readStdin (stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * The `import-keys` subcommand.
 *
 * Reads an encrypted keystore from a source path (or `-` for stdin),
 * validates its outer schema, and writes it to the keystore path.
 * Does not decrypt the file. Does not require the passphrase.
 *
 * @type {import('./index.js').Subcommand}
 */
export const importKeysCommand = {
  usage: 'atoll-bot import-keys <path> [--force]',
  description: 'Read a keystore and install it at the configured path',
  async run (args, flags, io) {
    if (args.length === 0 || !args[0]) {
      throw new UserError('import-keys requires a path')
    }

    const inputPath = args[0]
    const cwd = io.cwd ?? process.cwd()

    /** @type {Buffer} */
    let bytes
    if (inputPath === '-') {
      if (!io.stdin) {
        throw new UserError('import-keys from stdin requires an io.stdin stream')
      }
      try {
        bytes = await readStdin(io.stdin)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new UserError(`stdin: cannot read: ${msg}`)
      }
    } else {
      const srcPath = resolve(cwd, inputPath)
      if (!fs.existsSync(srcPath)) {
        throw new UserError(`${srcPath}: file not found`)
      }
      try {
        bytes = await fs.promises.readFile(srcPath)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new UserError(`${srcPath}: cannot read: ${msg}`)
      }
    }

    /** @type {Record<string, unknown>} */
    let parsed
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch {
      throw new UserError('source is not valid JSON')
    }

    const validation = validateOuter(parsed)
    if (!validation.ok) {
      throw new UserError(`source is not a valid keystore: ${validation.reason}`)
    }

    const keystorePath = resolveKeystorePath(io)

    if (fs.existsSync(keystorePath) && flags.force !== true && flags.f !== true) {
      throw new UserError(`${keystorePath}: keystore already exists; pass --force to overwrite`)
    }

    try {
      await fs.promises.writeFile(keystorePath, bytes, { mode: 0o600 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new UserError(`${keystorePath}: cannot write: ${msg}`)
    }

    const botId = String(parsed.bot_id)
    io.stdout.write(`Imported keystore for bot ${botId}.\n`)
    io.stdout.write(`Keystore written to ${keystorePath}.\n`)

    return 0
  }
}
