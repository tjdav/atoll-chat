/**
 * WASM SQLite backend implementation using @sqlite.org/sqlite-wasm.
 * Provides OPFS persistence on the web with fallback to in-memory SQLite.
 *
 * @module @atoll/app/lib/db/backends/wasm
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

/**
 * Creates a WASM-backed SQLite database backend instance.
 *
 * @param {object} [options] - Options.
 * @param {string} [options.dbName='messenger'] - Database name.
 * @returns {object} WASM backend instance.
 */
export function createWasmBackend({ dbName = 'messenger' } = {}) {
  let db = null
  let persistent = false

  /**
   * Returns whether the database backend is persisted via OPFS.
   *
   * @returns {boolean} True if OPFS persistent storage is active, false if fallback in-memory.
   */
  function isPersistent() {
    return persistent
  }

  /**
   * Opens the WASM SQLite database connection.
   * Attempts OPFS persistence (`OpfsDb`); falls back to in-memory (`DB`) if OPFS fails or is unavailable.
   *
   * @returns {Promise<void>} Resolves when ready.
   */
  async function open() {
    if (db) return

    const locateOptions = typeof window !== 'undefined' || typeof importScripts !== 'undefined'
      ? { locateFile: (file) => `/assets/sqlite/${file}` }
      : {}

    const sqlite3 = await sqlite3InitModule(locateOptions)

    try {
      if (sqlite3.oo1 && typeof sqlite3.oo1.OpfsDb === 'function') {
        db = new sqlite3.oo1.OpfsDb(`/${dbName}.sqlite3`)
        persistent = true
        return
      }
    } catch (_err) {
      // OPFS unavailable, failed, or running outside worker context. Fall through to in-memory.
    }

    db = new sqlite3.oo1.DB(':memory:', 'c')
    persistent = false
  }

  /**
   * Closes the database backend connection.
   *
   * @returns {Promise<void>} Resolves when closed.
   */
  async function close() {
    if (db) {
      db.close()
      db = null
    }
    persistent = false
  }

  /**
   * Ensures the database is opened before calling operations.
   *
   * @throws {Error} If db is not opened.
   */
  function ensureOpen() {
    if (!db) {
      throw new Error('Database is not opened. Call open() first.')
    }
  }

  /**
   * Begins a SQL transaction block.
   *
   * @returns {Promise<void>} Resolves when transaction begins.
   */
  async function begin() {
    ensureOpen()
    db.exec('BEGIN')
  }

  /**
   * Commits the active SQL transaction block.
   *
   * @returns {Promise<void>} Resolves when committed.
   */
  async function commit() {
    ensureOpen()
    db.exec('COMMIT')
  }

  /**
   * Rolls back the active SQL transaction block.
   *
   * @returns {Promise<void>} Resolves when rolled back.
   */
  async function rollback() {
    ensureOpen()
    db.exec('ROLLBACK')
  }

  /**
   * Executes a SQL write statement (`CREATE TABLE`, `INSERT`, `UPDATE`, `DELETE`).
   *
   * @param {string} sql - SQL statement.
   * @param {any[]} [params=[]] - Bound parameters.
   * @returns {Promise<{ changes: number, lastInsertId: number | null }>} Statement execution summary.
   */
  async function exec(sql, params = []) {
    ensureOpen()
    db.exec({
      sql,
      bind: params
    })

    const changes = db.changes()
    let lastInsertId = null

    // Fetch last_insert_rowid if write made changes
    if (changes > 0) {
      const rows = db.exec({
        sql: 'SELECT last_insert_rowid() as id',
        rowMode: 'object',
        returnValue: 'resultRows'
      })
      if (rows && rows[0] && rows[0].id !== undefined) {
        lastInsertId = rows[0].id
      }
    }

    return { changes, lastInsertId }
  }

  /**
   * Executes a read query returning all matching rows as plain objects.
   *
   * @param {string} sql - SQL statement.
   * @param {any[]} [params=[]] - Bound parameters.
   * @returns {Promise<Array<Record<string, any>>>} Array of matching row objects.
   */
  async function all(sql, params = []) {
    ensureOpen()
    const rawRows = db.exec({
      sql,
      bind: params,
      rowMode: 'object',
      returnValue: 'resultRows'
    })
    if (!rawRows) return []
    return rawRows.map((row) => ({ ...row }))
  }

  /**
   * Executes a read query returning the first matching row or `undefined`.
   *
   * @param {string} sql - SQL query.
   * @param {any[]} [params=[]] - Bound parameters.
   * @returns {Promise<Record<string, any> | undefined>} First matching row or undefined.
   */
  async function one(sql, params = []) {
    const rows = await all(sql, params)
    return rows[0] ?? undefined
  }

  return {
    open,
    close,
    exec,
    all,
    one,
    run: exec,
    begin,
    commit,
    rollback,
    isPersistent
  }
}
