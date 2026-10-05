/**
 * Creates a resolver that reads the passphrase from an environment
 * variable.
 *
 * @param {string} [name='ATOL_BOT_KEYSTORE_SECRET'] - The environment
 *   variable name to read.
 * @param {NodeJS.ProcessEnv} [env=process.env] - The environment to
 *   read from. Parameterized for testing.
 * @returns {import('./index.js').Resolver} A resolver that reads the named variable.
 */
export function envResolver (name = 'ATOL_BOT_KEYSTORE_SECRET', env = process.env) {
  return {
    id: 'env',
    async resolve () {
      const value = env[name]
      return typeof value === 'string' && value.length > 0 ? value : null
    }
  }
}
