import { RUNTIME_PREFIX } from '../storage/index.js'

/**
 * @typedef {'pause' | 'keystore_warning' | 'reconnect_storm' | 'operator'} SnapshotReason
 */

/**
 * @typedef {object} DiagnosticsCapture
 * @property {(reason: SnapshotReason, context?: object) => Promise<void>} recordSnapshot -
 *   Captures and stores a snapshot.
 * @property {(line: object) => void} recordLog - Appends a log line to
 *   the diagnostic file. Does not store in the runtime storage.
 * @property {(attempt: number, error?: unknown) => Promise<void>} notifyReconnectFailed -
 *   Increments the reconnect storm counter and triggers a snapshot if threshold is reached.
 * @property {() => void} notifyReconnectSuccess - Resets the reconnect storm counter.
 * @property {() => Promise<number>} prune - Deletes snapshots older
 *   than the retention window or malformed entries. Returns the count removed.
 * @property {() => Promise<void>} close - Awaits pending writes.
 */

const DIAGNOSTICS_STORAGE_PREFIX = `${RUNTIME_PREFIX}diagnostics:`

/**
 * Creates the diagnostics capture subsystem.
 *
 * Records snapshots on four triggers, writes them to storage under
 * `_runtime:diagnostics:<timestamp>`, and appends them to the
 * diagnostic file. Snapshots older than `retentionDays` are pruned by
 * `prune()`.
 *
 * @param {object} deps
 * @param {import('../storage/index.js').Storage} deps.storage - The
 *   runtime's storage backend.
 * @param {import('./diag-file-writer.js').DiagFileWriter} deps.diagFile -
 *   The diagnostic file writer.
 * @param {import('./logger.js').Logger} [deps.logger] - The runtime logger.
 * @param {() => object} deps.snapshotState - Returns the runtime's
 *   current state for inclusion in snapshots.
 * @param {string} [deps.botId] - Optional bot ID.
 * @param {number} [deps.retentionDays=7] - Snapshot retention in days.
 * @param {() => number} [deps.now=Date.now] - Clock function.
 * @param {number} [deps.reconnectStormThreshold=10] - Consecutive
 *   reconnect attempts required to trigger a snapshot.
 * @returns {DiagnosticsCapture}
 */
export function createDiagnosticsCapture ({
  storage,
  diagFile,
  logger,
  snapshotState,
  botId,
  retentionDays = 7,
  now = Date.now,
  reconnectStormThreshold = 10
}) {
  const startMs = now()
  let consecutiveReconnectFailures = 0

  /**
   * Captures and stores a diagnostic snapshot.
   *
   * @param {SnapshotReason} reason - Reason for snapshot.
   * @param {object} [context={}] - Optional caller context.
   * @returns {Promise<void>}
   */
  async function recordSnapshot (reason, context = {}) {
    const atISO = new Date(now()).toISOString()
    const uptimeMs = now() - startMs

    let state
    try {
      state = snapshotState()
    } catch {
      state = { error: 'snapshot_state_failed' }
    }

    let resolvedBotId = botId ?? ''
    if (!resolvedBotId && typeof state === 'object' && state !== null && 'bot_id' in state) {
      /** @type {any} */
      const stateObj = state
      resolvedBotId = String(stateObj.bot_id)
    }

    const snapshot = {
      type: 'snapshot',
      at: atISO,
      reason,
      context: context ?? {},
      state,
      bot_id: resolvedBotId,
      uptime_ms: uptimeMs
    }

    logger?.debug('diagnostics: snapshot recorded', {
      reason,
      at: atISO
    })

    const pFile = diagFile.append(snapshot)
    const pStorage = storage.set(`${DIAGNOSTICS_STORAGE_PREFIX}${atISO}`, snapshot)

    await Promise.all([pFile, pStorage])
  }

  /**
   * Appends a log line to the diagnostic file.
   *
   * @param {object} line - Log line object.
   */
  function recordLog (line) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      return
    }
    const atISO = new Date(now()).toISOString()
    diagFile.append({
      type: 'log',
      at: atISO,
      ...line
    })
  }

  /**
   * Called on a failed reconnect attempt.
   *
   * @param {number} attempt - Reconnect attempt number.
   * @param {unknown} [error] - Error or error message.
   * @returns {Promise<void>}
   */
  async function notifyReconnectFailed (attempt, error) {
    consecutiveReconnectFailures++
    if (consecutiveReconnectFailures >= reconnectStormThreshold) {
      let lastErrorMsg
      if (error instanceof Error) {
        lastErrorMsg = error.message
      } else if (typeof error === 'string') {
        lastErrorMsg = error
      } else if (error) {
        lastErrorMsg = String(error)
      }
      await recordSnapshot('reconnect_storm', {
        attempt,
        last_error: lastErrorMsg
      })
    }
  }

  /**
   * Called on a successful reconnect. Resets storm counter.
   */
  function notifyReconnectSuccess () {
    consecutiveReconnectFailures = 0
  }

  /**
   * Prunes snapshots older than retentionDays or malformed snapshots.
   *
   * @returns {Promise<number>} Count of removed entries.
   */
  async function prune () {
    const cutoffMs = now() - (retentionDays * 86400 * 1000)
    const keys = storage.keys()
    let removedCount = 0

    for (const key of keys) {
      if (!key.startsWith(DIAGNOSTICS_STORAGE_PREFIX)) {
        continue
      }

      const val = await storage.get(key)
      if (!val || typeof val !== 'object' || Array.isArray(val)) {
        await storage.delete(key)
        removedCount++
        continue
      }

      /** @type {any} */
      const valObj = val
      const atStr = valObj.at
      if (typeof atStr !== 'string') {
        await storage.delete(key)
        removedCount++
        continue
      }

      const atTime = Date.parse(atStr)
      if (Number.isNaN(atTime) || atTime < cutoffMs) {
        await storage.delete(key)
        removedCount++
      }
    }

    return removedCount
  }

  /**
   * Awaits pending diagnostic file writes.
   *
   * @returns {Promise<void>}
   */
  async function close () {
    await diagFile.close()
  }

  return {
    recordSnapshot,
    recordLog,
    notifyReconnectFailed,
    notifyReconnectSuccess,
    prune,
    close
  }
}
