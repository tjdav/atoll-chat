// SPDX-License-Identifier: AGPL-3.0-or-later

import { compose } from './compose.js'
import { emit } from './emit.js'

/**
 * Compiles an Instantiation into a BotScript. Runs the composer,
 * then the emitter, and returns both artifacts.
 *
 * The resulting BotScript carries the emitted bot.js source in
 * `code` and the resolved Composition in `composition`. The instance
 * writes `code` to disk and stores `composition` alongside it for
 * re-emission or for alternative-runtime consumption.
 *
 * Pure and deterministic. Same library state, rootDir, instantiation,
 * and options produce the same output.
 * @param {string} rootDir - The library root directory.
 * @param {Instantiation} instantiation - The instantiation to
 *   compile.
 * @param {object} options - Bot-level fields not carried by the
 *   instantiation.
 * @param {string} options.botId - The bot's identifier.
 * @param {string} options.label - Human-readable label.
 * @param {string} [options.apiVersion] - The bot's API version.
 * @param {string} [options.hostApi] - The host API range.
 * @param {{ fileId?: string, emoji?: string }} [options.avatar] -
 *   Optional avatar.
 * @returns {Promise<BotScript>} The compiled script and its source
 *   composition.
 * @throws {Error} When composition or emission fails.
 */
export async function compile (rootDir, instantiation, options) {
  if (options === null || typeof options !== 'object') {
    throw new Error('compile: options must be an object')
  }

  const composition = await compose(rootDir, instantiation)
  const code = emit(composition, options)
  return { code, composition }
}
