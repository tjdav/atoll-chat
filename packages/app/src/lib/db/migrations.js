/**
 * Migration runner and SQL statement splitter.
 *
 * @module @atoll/app/lib/db/migrations
 */

/**
 * Splits a multi-statement SQL string on statement boundaries (`;`).
 * Handles single quotes `'...'`, double quotes `"..."`, and line comments `-- ...`.
 *
 * @param {string} sql - Multi-statement SQL text.
 * @returns {string[]} Array of individual non-empty SQL statements.
 */
export function splitStatements(sql) {
  const statements = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let inComment = false

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]
    const nextChar = sql[i + 1]

    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false
      }
      continue
    }

    if (!inSingle && !inDouble) {
      if (char === '-' && nextChar === '-') {
        inComment = true
        i++ // Skip second hyphen
        continue
      }
      if (char === "'") {
        inSingle = true
        current += char
        continue
      }
      if (char === '"') {
        inDouble = true
        current += char
        continue
      }
      if (char === ';') {
        const trimmed = current.trim()
        if (trimmed) {
          statements.push(trimmed)
        }
        current = ''
        continue
      }
    } else if (inSingle) {
      if (char === "'") {
        inSingle = false
      }
      current += char
      continue
    } else if (inDouble) {
      if (char === '"') {
        inDouble = false
      }
      current += char
      continue
    }

    current += char
  }

  const finalTrimmed = current.trim()
  if (finalTrimmed) {
    statements.push(finalTrimmed)
  }

  return statements
}

/**
 * Runs missing database migrations in ascending order by name inside transaction blocks.
 *
 * @param {object} params - Options.
 * @param {object} params.backend - Database backend instance.
 * @param {Array<{ name: string, sql: string }>} params.migrations - Sorted array of migration objects.
 * @returns {Promise<{ applied: string[], skipped: string[] }>} Summary of applied and skipped migration names.
 */
export async function runMigrations({ backend, migrations = [] }) {
  // 1. Ensure _migrations table exists (idempotent bootstrap)
  await backend.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `, [])

  // 2. Query applied migrations
  const rows = await backend.all('SELECT name FROM _migrations ORDER BY name ASC', [])
  const appliedSet = new Set(rows.map((r) => r.name))

  const applied = []
  const skipped = []

  // 3. Apply missing migrations in order
  for (const migration of migrations) {
    if (appliedSet.has(migration.name)) {
      skipped.push(migration.name)
      continue
    }

    const statements = splitStatements(migration.sql)
    await backend.begin()
    try {
      for (const statement of statements) {
        await backend.exec(statement, [])
      }
      await backend.exec('INSERT OR REPLACE INTO _migrations (name, applied_at) VALUES (?, ?)', [
        migration.name,
        Date.now()
      ])
      await backend.commit()
      applied.push(migration.name)
    } catch (err) {
      await backend.rollback()
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Migration ${migration.name} failed: ${message}`)
    }
  }

  return { applied, skipped }
}
