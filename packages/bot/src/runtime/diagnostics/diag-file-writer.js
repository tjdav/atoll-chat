import { appendFile, writeFile } from 'node:fs/promises'

/**
 * Creates a diagnostic file writer.
 *
 * Appends JSON Lines to `<keystorePath>.diag.jsonl`. Writes are
 * serialized through an internal queue. Failures are logged at warn
 * and do not throw. The file is created on first write with mode
 * 0o600.
 *
 * @param {object} deps
 * @param {string} deps.path - The diagnostic file path.
 * @param {import('./logger.js').Logger} [deps.logger] - The runtime
 *   logger (for reporting write failures).
 * @param {() => number} [deps.now=Date.now] - Optional clock function.
 * @returns {import('./diag-file-writer.js').DiagFileWriter}
 */
export function createDiagFileWriter ({ path, logger, now = Date.now }) {
  let queue = Promise.resolve()
  let pending = 0
  let lastWarnTime = 0

  /**
   * Appends a JSON-serialized record followed by a newline.
   *
   * @param {object} record - Record object to append.
   * @returns {Promise<void>}
   */
  async function append (record) {
    pending++
    queue = queue
      .then(async () => {
        let serialized
        try {
          serialized = JSON.stringify(record)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger?.warn('diagnostic file record serialization failed', {
            path,
            error: msg
          })
          return
        }

        try {
          await appendFile(path, serialized + '\n', { mode: 0o600 })
        } catch (err) {
          const currentTime = now()
          if (currentTime - lastWarnTime >= 60000) {
            lastWarnTime = currentTime
            const msg = err instanceof Error ? err.message : String(err)
            logger?.warn('diagnostic file write failed', {
              path,
              error: msg
            })
          }
        }
      })
      .catch(() => {
      })
      .finally(() => {
        pending--
      })

    return queue
  }

  /**
   * Truncates the file (creates it empty if absent).
   *
   * @returns {Promise<void>}
   */
  async function truncate () {
    pending++
    queue = queue
      .then(async () => {
        try {
          await writeFile(path, '', { mode: 0o600 })
        } catch (err) {
          const currentTime = now()
          if (currentTime - lastWarnTime >= 60000) {
            lastWarnTime = currentTime
            const msg = err instanceof Error ? err.message : String(err)
            logger?.warn('diagnostic file truncate failed', {
              path,
              error: msg
            })
          }
        }
      })
      .catch(() => {
      })
      .finally(() => {
        pending--
      })

    return queue
  }

  /**
   * Awaits pending writes. Idempotent.
   *
   * @returns {Promise<void>}
   */
  async function close () {
    return queue
  }

  /**
   * Returns the count of pending operations.
   *
   * @returns {number}
   */
  function pendingCount () {
    return pending
  }

  return {
    append,
    truncate,
    close,
    pendingCount
  }
}

/**
 * @typedef {object} DiagFileWriter
 * @property {(record: object) => Promise<void>} append - Appends a
 *   JSON-serialized record followed by a newline.
 * @property {() => Promise<void>} truncate - Truncates the file.
 * @property {() => Promise<void>} close - Awaits pending writes.
 * @property {() => number} pendingCount - Count of pending writes.
 */
