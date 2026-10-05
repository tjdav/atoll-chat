/**
 * Database factory module for storage layer.
 *
 * @module @atoll/app/lib/db/index
 */

import { resolveBackend } from './backends/index.js'
import { runMigrations } from './migrations.js'

/**
 * Creates a database instance with migration runner and meta helpers.
 *
 * @param {object} [options] - Options.
 * @param {string} [options.dbName='messenger'] - Database name.
 * @param {object} [options.backend] - Pre-built backend instance.
 * @param {Array<{ name: string, sql: string }>} [options.migrations=[]] - Array of migration objects.
 * @returns {object} DB handle.
 */
export function createDb({ dbName = 'messenger', backend, migrations = [] } = {}) {
  const activeBackend = backend ?? resolveBackend()
  const dbState = {
    opened: false,
    backend: activeBackend,
    openPromise: /** @type {Promise<{ applied: string[], skipped: string[] }> | null} */ (null)
  }

  /**
   * Opens the database connection and runs pending migrations. Idempotent.
   * Concurrent calls share the same opening promise.
   *
   * @returns {Promise<{ applied: string[], skipped: string[] }>} Applied and skipped migrations.
   */
  async function open() {
    if (dbState.opened) {
      const rows = dbState.backend.all('SELECT name FROM _migrations ORDER BY name ASC', [])
      const allNames = rows.map((r) => r.name)
      return { applied: [], skipped: allNames }
    }

    if (dbState.openPromise) {
      return dbState.openPromise
    }

    dbState.openPromise = (async () => {
      try {
        await dbState.backend.open()
        const result = await runMigrations({ backend: dbState.backend, migrations })
        dbState.opened = true
        return result
      } finally {
        dbState.openPromise = null
      }
    })()

    return dbState.openPromise
  }

  /**
   * Closes the database backend.
   *
   * @returns {Promise<void>} Resolves when closed.
   */
  async function close() {
    await dbState.backend.close()
    dbState.opened = false
  }

  /**
   * Executes a query returning all matching rows.
   *
   * @param {string} sql - SQL query.
   * @param {any[]} [params=[]] - Query parameters.
   * @returns {Array<Record<string, any>>} Array of matching rows.
   */
  function query(sql, params = []) {
    return dbState.backend.all(sql, params)
  }

  /**
   * Executes a query returning the first matching row or undefined.
   *
   * @param {string} sql - SQL query.
   * @param {any[]} [params=[]] - Query parameters.
   * @returns {Record<string, any> | undefined} First matching row or undefined.
   */
  function queryOne(sql, params = []) {
    return dbState.backend.one(sql, params)
  }

  /**
   * Executes a write statement.
   *
   * @param {string} sql - SQL statement.
   * @param {any[]} [params=[]] - Statement parameters.
   * @returns {{ changes: number, lastInsertId: number | null }} Result summary.
   */
  function execute(sql, params = []) {
    return dbState.backend.exec(sql, params)
  }

  /**
   * Executes a synchronous or asynchronous callback inside a transaction block.
   * Rolls back on error.
   *
   * @template T
   * @param {() => Promise<T> | T} fn - Function to execute inside transaction.
   * @returns {Promise<T>} Result of fn.
   */
  async function transaction(fn) {
    dbState.backend.begin()
    try {
      const result = await fn()
      dbState.backend.commit()
      return result
    } catch (err) {
      dbState.backend.rollback()
      throw err
    }
  }

  /**
   * Meta subsystem helpers for the `_meta` table.
   */
  const meta = {
    /**
     * Retrieves and parses a JSON metadata value by key.
     *
     * @param {string} key - Metadata key.
     * @returns {any} Parsed value or undefined if not found.
     */
    get(key) {
      const row = dbState.backend.one('SELECT value_json FROM _meta WHERE key = ?', [key])
      if (!row || !row.value_json) {
        return undefined
      }
      return JSON.parse(row.value_json)
    },

    /**
     * Upserts a metadata key-value pair.
     *
     * @param {string} key - Metadata key.
     * @param {any} value - Value to serialize to JSON.
     * @returns {{ changes: number, lastInsertId: number | null }} Result summary.
     */
    set(key, value) {
      const json = JSON.stringify(value)
      const now = Date.now()
      return dbState.backend.exec(
        'INSERT OR REPLACE INTO _meta (key, value_json, updated_at) VALUES (?, ?, ?)',
        [key, json, now]
      )
    },

    /**
     * Deletes a metadata key.
     *
     * @param {string} key - Metadata key.
     * @returns {{ changes: number, lastInsertId: number | null }} Result summary.
     */
    delete(key) {
      return dbState.backend.exec('DELETE FROM _meta WHERE key = ?', [key])
    }
  }

  return {
    open,
    close,
    query,
    queryOne,
    execute,
    transaction,
    meta
  }
}
