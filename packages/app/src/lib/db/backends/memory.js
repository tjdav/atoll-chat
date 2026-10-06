/**
 * In-memory SQLite-compatible backend implementation for testing and degradation mode.
 *
 * @module @atoll/app/lib/db/backends/memory
 */

/**
 * Creates an in-memory database backend instance.
 *
 * @returns {object} The backend instance.
 */
export function createMemoryBackend() {
  /** @type {Map<string, { primaryKey: string | null, rows: Array<Record<string, any>> }>} */
  let tables = new Map()
  /** @type {Array<Map<string, { primaryKey: string | null, rows: Array<Record<string, any>> }>>} */
  const txStack = []

  /**
   * Deeply clones the tables map for transaction snapshotting.
   *
   * @param {Map<string, { primaryKey: string | null, rows: Array<Record<string, any>> }>} source - Source map.
   * @returns {Map<string, { primaryKey: string | null, rows: Array<Record<string, any>> }>} Cloned map.
   */
  function cloneTables(source) {
    const copy = new Map()
    for (const [tableName, tableDef] of source.entries()) {
      copy.set(tableName, {
        primaryKey: tableDef.primaryKey,
        rows: tableDef.rows.map((row) => ({ ...row }))
      })
    }
    return copy
  }

  /**
   * Helper to parse and evaluate a WHERE condition of the form `WHERE col = ?` or `WHERE col = val`.
   *
   * @param {string} whereClause - Raw WHERE clause SQL string.
   * @param {any[]} params - Bound parameters.
   * @param {number} paramOffset - Current offset in the params array.
   * @returns {{ filterFn: (row: Record<string, any>) => boolean, consumedParams: number }} Filter function and parameter count used.
   */
  function parseWhere(whereClause, params, paramOffset) {
    if (!whereClause) {
      return { filterFn: () => true, consumedParams: 0 }
    }
    const match = whereClause.match(/^\s*WHERE\s+([a-zA-Z0-9_]+)\s*=\s*(\?|'[^']*'|"[^"]*"|\d+)\s*$/i)
    if (!match) {
      throw new Error(`Unsupported WHERE clause: ${whereClause}`)
    }
    const colName = match[1]
    const valToken = match[2]
    let targetVal
    let consumedParams = 0

    if (valToken === '?') {
      targetVal = params[paramOffset]
      consumedParams = 1
    } else if (valToken.startsWith("'") && valToken.endsWith("'")) {
      targetVal = valToken.slice(1, -1)
    } else if (valToken.startsWith('"') && valToken.endsWith('"')) {
      targetVal = valToken.slice(1, -1)
    } else {
      targetVal = Number(valToken)
    }

    return {
      filterFn: (row) => row[colName] === targetVal,
      consumedParams
    }
  }

  /**
   * Opens the backend connection (no-op for memory backend).
   *
   * @returns {Promise<void>} Resolves when ready.
   */
  async function open() {
    // In-memory backend is initialized and ready immediately.
  }

  /**
   * Closes the backend connection and clears all in-memory tables.
   *
   * @returns {Promise<void>} Resolves when closed.
   */
  async function close() {
    tables.clear()
    txStack.length = 0
  }

  /**
   * Begins a new transaction by snapshotting the current tables state.
   *
   * @returns {Promise<void>} Resolves when transaction begins.
   */
  async function begin() {
    txStack.push(cloneTables(tables))
  }

  /**
   * Commits the current transaction by discarding the latest snapshot.
   *
   * @returns {Promise<void>} Resolves when committed.
   */
  async function commit() {
    if (txStack.length === 0) {
      throw new Error('No transaction active to commit')
    }
    txStack.pop()
  }

  /**
   * Rolls back the current transaction by restoring the latest snapshot.
   *
   * @returns {Promise<void>} Resolves when rolled back.
   */
  async function rollback() {
    if (txStack.length === 0) {
      throw new Error('No transaction active to rollback')
    }
    tables = txStack.pop()
  }

  /**
   * Executes a write statement (`CREATE TABLE`, `INSERT`, `UPDATE`, `DELETE`).
   *
   * @param {string} sql - SQL statement.
   * @param {any[]} [params=[]] - Bound parameters.
   * @returns {Promise<{ changes: number, lastInsertId: number | null }>} Statement execution summary.
   */
  async function exec(sql, params = []) {
    const trimmedSql = sql.trim().replace(/;$/, '')

    // 1. CREATE TABLE IF NOT EXISTS <tableName> (...)
    const createTableMatch = trimmedSql.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s*\(([\s\S]+)\)$/i)
    if (createTableMatch) {
      const tableName = createTableMatch[1]
      const body = createTableMatch[2]
      if (!tables.has(tableName)) {
        let primaryKey = null
        const colDefs = body.split(',').map((s) => s.trim())
        for (const colDef of colDefs) {
          const parts = colDef.split(/\s+/)
          const colName = parts[0]
          if (colDef.toUpperCase().includes('PRIMARY KEY')) {
            primaryKey = colName
          }
        }
        tables.set(tableName, { primaryKey, rows: [] })
      }
      return { changes: 0, lastInsertId: null }
    }

    // 2. INSERT [OR REPLACE] INTO <tableName> (<cols>) VALUES (?, ...)
    const insertMatch = trimmedSql.match(/^INSERT\s+(?:OR\s+(REPLACE)\s+)?INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)$/i)
    if (insertMatch) {
      const isReplace = Boolean(insertMatch[1])
      const tableName = insertMatch[2]
      const cols = insertMatch[3].split(',').map((c) => c.trim())
      const placeholders = insertMatch[4].split(',').map((p) => p.trim())

      const table = tables.get(tableName)
      if (!table) {
        throw new Error(`Table does not exist: ${tableName}`)
      }

      if (placeholders.length !== cols.length) {
        throw new Error(`Mismatched column count and values in INSERT statement for table ${tableName}`)
      }

      const row = {}
      let pIdx = 0
      for (let i = 0; i < cols.length; i++) {
        const ph = placeholders[i]
        if (ph === '?') {
          row[cols[i]] = params[pIdx++]
        } else if (ph.startsWith("'") && ph.endsWith("'")) {
          row[cols[i]] = ph.slice(1, -1)
        } else if (ph.startsWith('"') && ph.endsWith('"')) {
          row[cols[i]] = ph.slice(1, -1)
        } else if (!Number.isNaN(Number(ph))) {
          row[cols[i]] = Number(ph)
        } else {
          throw new Error(`Unsupported value token in INSERT: ${ph}`)
        }
      }

      let changes = 0
      if (table.primaryKey && row[table.primaryKey] !== undefined) {
        const pkVal = row[table.primaryKey]
        const existingIdx = table.rows.findIndex((r) => r[table.primaryKey] === pkVal)
        if (existingIdx >= 0) {
          if (!isReplace) {
            throw new Error(`UNIQUE constraint failed: ${tableName}.${table.primaryKey}`)
          }
          table.rows[existingIdx] = row
          changes = 1
        } else {
          table.rows.push(row)
          changes = 1
        }
      } else {
        table.rows.push(row)
        changes = 1
      }

      return { changes, lastInsertId: null }
    }

    // 3. UPDATE <tableName> SET col1 = ?, col2 = ? [WHERE col = ?]
    const updateMatch = trimmedSql.match(/^UPDATE\s+([a-zA-Z0-9_]+)\s+SET\s+(.+?)(?:\s+(WHERE\s+.+))?$/i)
    if (updateMatch) {
      const tableName = updateMatch[1]
      const setClause = updateMatch[2]
      const whereClause = updateMatch[3]

      const table = tables.get(tableName)
      if (!table) {
        throw new Error(`Table does not exist: ${tableName}`)
      }

      const setAssignments = setClause.split(',').map((s) => s.trim())
      let paramIdx = 0

      /** @type {Array<{ col: string, val: any, isParam: boolean }>} */
      const assignments = setAssignments.map((assign) => {
        const parts = assign.split('=').map((s) => s.trim())
        const col = parts[0]
        const valToken = parts[1]
        if (valToken === '?') {
          return { col, val: params[paramIdx++], isParam: true }
        }
        if (valToken.startsWith("'") && valToken.endsWith("'")) {
          return { col, val: valToken.slice(1, -1), isParam: false }
        }
        return { col, val: Number(valToken), isParam: false }
      })

      const { filterFn } = parseWhere(whereClause, params, paramIdx)

      let changes = 0
      for (const row of table.rows) {
        if (filterFn(row)) {
          for (const assign of assignments) {
            row[assign.col] = assign.val
          }
          changes++
        }
      }

      return { changes, lastInsertId: null }
    }

    // 4. DELETE FROM <tableName> [WHERE col = ?]
    const deleteMatch = trimmedSql.match(/^DELETE\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+(WHERE\s+.+))?$/i)
    if (deleteMatch) {
      const tableName = deleteMatch[1]
      const whereClause = deleteMatch[2]

      const table = tables.get(tableName)
      if (!table) {
        throw new Error(`Table does not exist: ${tableName}`)
      }

      const { filterFn } = parseWhere(whereClause, params, 0)
      const initialCount = table.rows.length
      table.rows = table.rows.filter((row) => !filterFn(row))
      const changes = initialCount - table.rows.length

      return { changes, lastInsertId: null }
    }

    throw new Error(`Unsupported SQL statement in memory backend: ${sql}`)
  }

  /**
   * Executes a read statement (`SELECT`).
   *
   * @param {string} sql - SQL statement.
   * @param {any[]} [params=[]] - Bound parameters.
   * @returns {Promise<Array<Record<string, any>>>} Array of matching row objects.
   */
  async function all(sql, params = []) {
    const trimmedSql = sql.trim().replace(/;$/, '')

    // SELECT <cols> FROM <tableName> [WHERE ...] [ORDER BY col ASC|DESC]
    const selectMatch = trimmedSql.match(/^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+([a-zA-Z0-9_]+)(?:\s+(ASC|DESC))?)?$/i)
    if (!selectMatch) {
      throw new Error(`Unsupported SQL query in memory backend: ${sql}`)
    }

    const colsStr = selectMatch[1]
    const tableName = selectMatch[2]
    const whereCond = selectMatch[3] ? `WHERE ${selectMatch[3]}` : undefined
    const orderCol = selectMatch[4]
    const orderDir = (selectMatch[5] || 'ASC').toUpperCase()

    const table = tables.get(tableName)
    if (!table) {
      throw new Error(`Table does not exist: ${tableName}`)
    }

    const { filterFn } = parseWhere(whereCond, params, 0)
    let matchingRows = table.rows.filter(filterFn)

    if (orderCol) {
      matchingRows = [...matchingRows].sort((a, b) => {
        const valA = a[orderCol]
        const valB = b[orderCol]
        if (valA < valB) return orderDir === 'ASC' ? -1 : 1
        if (valA > valB) return orderDir === 'ASC' ? 1 : -1
        return 0
      })
    }

    if (colsStr === '*') {
      return matchingRows.map((row) => ({ ...row }))
    }

    const cols = colsStr.split(',').map((c) => c.trim())
    return matchingRows.map((row) => {
      const projected = {}
      for (const col of cols) {
        projected[col] = row[col]
      }
      return projected
    })
  }

  /**
   * Executes a read statement and returns the first row or `undefined`.
   *
   * @param {string} sql - SQL query.
   * @param {any[]} [params=[]] - Bound parameters.
   * @returns {Promise<Record<string, any> | undefined>} First matching row or undefined.
   */
  async function one(sql, params = []) {
    const rows = await all(sql, params)
    return rows[0]
  }

  /**
   * Returns whether storage persists across page reloads.
   *
   * @returns {Promise<boolean>} Resolves to false for in-memory storage.
   */
  async function isPersistent() {
    return false
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
