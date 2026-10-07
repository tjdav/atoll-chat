import { definePlugin } from 'coralite'
import { fileURLToPath } from 'node:url'

/**
 * Storage Coralite plugin factory.
 *
 * Factory options are evaluated at build time in Node. They are not
 * serialized into the client bundle. Coralite delivers the `client.config`
 * object to the context resolver as `pluginContext.config`. Do not read
 * `options` directly inside `client.context`.
 *
 * @param {object} [options] - Plugin configuration options.
 * @param {string} [options.dbName='messenger'] - Database name.
 * @param {Array<{ name: string, sql: string }>} [options.migrations=[]] - Migration files.
 * @returns {import('coralite').Plugin} Coralite plugin instance.
 */
export default (options = {}) => {
  const dbName = options.dbName ?? 'messenger'
  const migrations = options.migrations ?? []

  return definePlugin({
    name: 'storage',
    rootDir: process.cwd(),
    filePath: fileURLToPath(import.meta.url),

    server: {
      context: (_pluginContext) => (_instanceContext) => ({
        open: () => {
          throw new Error('storage.open is not available during SSR. The database is client-only.')
        },
        close: () => {},
        query: () => {
          throw new Error('storage.query is not available during SSR. The database is client-only.')
        },
        queryOne: () => {
          throw new Error('storage.queryOne is not available during SSR. The database is client-only.')
        },
        execute: () => {
          throw new Error('storage.execute is not available during SSR. The database is client-only.')
        },
        transaction: () => {
          throw new Error('storage.transaction is not available during SSR. The database is client-only.')
        },
        meta: {
          get: () => undefined,
          set: () => {},
          delete: () => ({ changes: 0 })
        },
        repos: () => {
          throw new Error('storage.repos is not available during SSR. The database is client-only.')
        }
      })
    },

    client: {
      config: { dbName, migrations },
      context: async (pluginContext) => {
        const [{ createDb }, { createRepositories }] = await Promise.all([
          import('../lib/db/index.js'),
          import('../lib/db/repositories/index.js')
        ])
        const activeDbName = pluginContext.config?.dbName ?? 'messenger'
        const activeMigrations = pluginContext.config?.migrations ?? []
        const db = pluginContext.__storage_client__ ??
          (pluginContext.__storage_client__ = createDb({ dbName: activeDbName, migrations: activeMigrations }))
        const repos = pluginContext.__storage_repos_client__ ??
          (pluginContext.__storage_repos_client__ = createRepositories({ db }))

        return (_instanceContext) => ({
          open: () => db.open(),
          close: () => db.close(),
          query: (sql, params) => db.query(sql, params),
          queryOne: (sql, params) => db.queryOne(sql, params),
          execute: (sql, params) => db.execute(sql, params),
          transaction: (fn) => db.transaction(fn),
          meta: {
            get: (key) => db.meta.get(key),
            set: (key, value) => db.meta.set(key, value),
            delete: (key) => db.meta.delete(key)
          },
          repos: () => repos
        })
      }
    }
  })
}
