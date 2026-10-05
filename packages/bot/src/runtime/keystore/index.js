import { readFile, writeFile, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { KeystoreLockedError, KeystoreCorruptError } from '../../errors.js'
import { deriveKey, encrypt, decrypt } from './crypto.js'
import { validateOuter, validatePlaintext } from './schema.js'
import { resolveChain } from './resolvers/index.js'

/**
 * @typedef {import('./resolvers/index.js').Resolver} Resolver
 */

/**
 * Extracts error message safely.
 *
 * @param {unknown} err - Error object or unknown value.
 * @returns {string} Error message.
 */
function getErrorMessage (err) {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The encrypted keystore for a single bot. Holds the path and the
 * resolver chain. Caches the resolved secret in memory between calls
 * so that `save()` does not re-run the resolver chain.
 */
export class Keystore {
  /** @type {string} */
  #path
  /** @type {Resolver[]} */
  #resolvers
  /** @type {string | undefined} */
  #cachedSecret
  /** @type {string | undefined} */
  #botId

  /**
   * @param {object} options
   * @param {string} options.path - Absolute path to the keystore file.
   * @param {Resolver[]} options.resolvers - Resolvers to try in order.
   */
  constructor ({ path, resolvers }) {
    this.#path = path
    this.#resolvers = resolvers
  }

  /**
   * Returns true when the keystore file exists on disk.
   *
   * @returns {Promise<boolean>}
   */
  async exists () {
    try {
      const stats = await stat(this.#path)
      return stats.isFile()
    } catch {
      return false
    }
  }

  /**
   * Loads and decrypts the keystore. Caches the resolved secret for
   * subsequent `save()` calls.
   *
   * @returns {Promise<object>} The decrypted plaintext.
   * @throws {KeystoreLockedError} When the file does not exist, no
   *   resolver returns a secret, or the secret is wrong (the tag does
   *   not verify).
   * @throws {KeystoreCorruptError} When the file is not valid JSON,
   *   fails outer schema validation, is not decryptable due to
   *   corruption, or fails plaintext schema validation.
   */
  async load () {
    let fileText
    try {
      fileText = await readFile(this.#path, 'utf8')
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
        throw new KeystoreLockedError(`Keystore file not found at path: ${this.#path}`)
      }
      throw err
    }

    let outer
    try {
      outer = JSON.parse(fileText)
    } catch (err) {
      throw new KeystoreCorruptError(`Keystore file is not valid JSON: ${getErrorMessage(err)}`)
    }

    const outerValidation = validateOuter(outer)
    if (!outerValidation.ok) {
      throw new KeystoreCorruptError(`Keystore outer schema validation failed: ${outerValidation.reason}`)
    }

    const salt = Buffer.from(outer.salt, 'base64url')
    const nonce = Buffer.from(outer.nonce, 'base64url')
    const ct = Buffer.from(outer.ct, 'base64url')

    const interactive = Boolean(process.stdout && process.stdout.isTTY)
    const secret = await resolveChain(this.#resolvers, {
      botId: outer.bot_id,
      path: this.#path,
      interactive
    })

    if (!secret) {
      throw new KeystoreLockedError(`No passphrase could be resolved for keystore (${outer.bot_id})`)
    }

    let derivedKey
    try {
      derivedKey = await deriveKey(secret, salt)
    } catch (err) {
      throw new KeystoreCorruptError(`Key derivation failed: ${getErrorMessage(err)}`)
    }

    let decryptedBytes
    try {
      decryptedBytes = decrypt(derivedKey, nonce, ct)
    } catch (err) {
      throw new KeystoreLockedError(`Decryption failed (invalid passphrase or corrupted tag): ${getErrorMessage(err)}`)
    }

    let plaintext
    try {
      const plaintextStr = Buffer.from(decryptedBytes).toString('utf8')
      plaintext = JSON.parse(plaintextStr)
    } catch (err) {
      throw new KeystoreCorruptError(`Decrypted plaintext is not valid JSON: ${getErrorMessage(err)}`)
    }

    const plaintextValidation = validatePlaintext(plaintext, outer.bot_id)
    if (!plaintextValidation.ok) {
      throw new KeystoreCorruptError(`Keystore plaintext schema validation failed: ${plaintextValidation.reason}`)
    }

    this.#cachedSecret = secret
    this.#botId = outer.bot_id

    return plaintext
  }

  /**
   * Encrypts and writes the keystore. Requires a prior `load()` or a
   * prior `save()`; throws `keystore_locked` when no secret has been
   * resolved.
   *
   * @param {object} data - The plaintext to save.
   * @returns {Promise<void>}
   * @throws {KeystoreLockedError} When no secret has been resolved.
   * @throws {KeystoreCorruptError} When data fails schema validation.
   */
  async save (data) {
    if (!this.#cachedSecret) {
      throw new KeystoreLockedError('Cannot save keystore: no passphrase has been resolved. Call load() first or create explicit keystore.')
    }

    const botId = 'bot_id' in data && typeof data.bot_id === 'string' ? data.bot_id : undefined
    if (typeof botId !== 'string') {
      throw new KeystoreCorruptError('Cannot save keystore: data.bot_id is missing or not a string')
    }

    const validation = validatePlaintext(data, botId)
    if (!validation.ok) {
      throw new KeystoreCorruptError(`Cannot save keystore: schema validation failed: ${validation.reason}`)
    }

    const salt = randomBytes(16)
    const nonce = randomBytes(12)

    const key = await deriveKey(this.#cachedSecret, salt)
    const plaintextBytes = Buffer.from(JSON.stringify(data), 'utf8')
    const ctBytes = encrypt(key, nonce, plaintextBytes)

    const outer = {
      version: 1,
      bot_id: botId,
      salt: Buffer.from(salt).toString('base64url'),
      nonce: Buffer.from(nonce).toString('base64url'),
      ct: Buffer.from(ctBytes).toString('base64url')
    }

    await writeFile(this.#path, JSON.stringify(outer, null, 2), { mode: 0o600 })
    this.#botId = botId
  }

  /**
   * The bot_id from the most recent load or save. Undefined before the
   * first call.
   *
   * @returns {string | undefined}
   */
  get botId () {
    return this.#botId
  }
}

/**
 * Creates a new keystore file. Validates the plaintext, encrypts it
 * with the given secret, and writes the file. Overwrites an existing
 * file at the same path.
 *
 * @param {object} options
 * @param {string} options.path - Absolute path for the new file.
 * @param {string} options.secret - The passphrase to encrypt with.
 * @param {object} options.data - The plaintext. Must include `bot_id`
 *   and all required fields from §2 above.
 * @returns {Promise<void>}
 * @throws {KeystoreCorruptError} When the plaintext fails schema
 *   validation.
 */
export async function createKeystore ({ path, secret, data }) {
  const botId = 'bot_id' in data && typeof data.bot_id === 'string' ? data.bot_id : undefined
  if (typeof botId !== 'string') {
    throw new KeystoreCorruptError('Cannot create keystore: data.bot_id is missing or not a string')
  }

  const validation = validatePlaintext(data, botId)
  if (!validation.ok) {
    throw new KeystoreCorruptError(`Cannot create keystore: schema validation failed: ${validation.reason}`)
  }

  const salt = randomBytes(16)
  const nonce = randomBytes(12)

  const key = await deriveKey(secret, salt)
  const plaintextBytes = Buffer.from(JSON.stringify(data), 'utf8')
  const ctBytes = encrypt(key, nonce, plaintextBytes)

  const outer = {
    version: 1,
    bot_id: botId,
    salt: Buffer.from(salt).toString('base64url'),
    nonce: Buffer.from(nonce).toString('base64url'),
    ct: Buffer.from(ctBytes).toString('base64url')
  }

  await writeFile(path, JSON.stringify(outer, null, 2), { mode: 0o600 })
}
