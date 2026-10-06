/**
 * Repository aggregator module.
 *
 * Exposes a unified factory for creating domain repositories around a DB handle.
 *
 * @module @atoll/app/lib/db/repositories/index
 */

import { createUsersRepository } from './users.js'

/**
 * Creates all domain repositories configured with the provided DB instance.
 *
 * @param {object} options - Options.
 * @param {object} options.db - Opened or lazy database handle from createDb.
 * @returns {object} Aggregated repository map.
 */
export function createRepositories({ db }) {
  return {
    users: createUsersRepository({ db })
  }
}

export { createUsersRepository }
