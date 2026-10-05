/**
 * A secret resolver. Given context about the keystore being loaded,
 * returns the passphrase or null to defer to the next resolver.
 *
 * @typedef {object} Resolver
 * @property {string} id - A stable name for diagnostics and error
 *   messages. Examples: 'env', 'keychain:macos', 'prompt'.
 * @property {(ctx: ResolverContext) => Promise<string | null>} resolve -
 *   The resolve function. Returns the passphrase, or null when this
 *   resolver has nothing to offer.
 */

/**
 * Context passed to a resolver.
 *
 * @typedef {object} ResolverContext
 * @property {string} botId - The bot_id from the outer file structure.
 * @property {string} path - The absolute path to the keystore file.
 * @property {boolean} interactive - True when the process is running
 *   in an interactive terminal. The prompt resolver (B-008b) refuses
 *   to run when this is false.
 */

/**
 * Runs a chain of resolvers, returning the first non-null result.
 *
 * @param {Resolver[]} resolvers - The resolvers to try in order.
 * @param {ResolverContext} ctx - The context to pass to each.
 * @returns {Promise<string | null>} The first non-null result, or null
 *   when every resolver defers.
 */
export async function resolveChain (resolvers, ctx) {
  for (const resolver of resolvers) {
    const result = await resolver.resolve(ctx)
    if (result !== null) {
      return result
    }
  }
  return null
}
