import { definePlugin } from 'coralite'
import { fileURLToPath } from 'node:url'
import { createDb } from '../lib/db/index.js'

/**
 * Storage Coralite plugin factory.
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
        }
      })
    },

    client: {
      context: (pluginContext) => (_instanceContext) => {
        const db = pluginContext.__storage_client__ ??
          (pluginContext.__storage_client__ = createDb({ dbName, migrations }))
        return {
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
          }
        }
      }
    }
  })
}
