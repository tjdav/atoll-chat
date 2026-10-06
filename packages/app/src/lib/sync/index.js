/**
 * User-scoped sync library.
 * Performs GET /users/me/sync, updates repository state, and manages sequence cursor.
 *
 * @module @atoll/app/lib/sync/index
 */

import { applyReadState, applyDeviceState, applyStarredItems } from './apply.js'

/**
 * Runs user-scoped sync for the local authenticated user.
 *
 * @param {object} deps - Injected dependencies.
 * @param {object} deps.api - API client instance (e.g. lib/api/client.js singleton).
 * @param {object} deps.storage - Storage plugin context or handle providing meta methods.
 * @param {object} deps.repos - Repository aggregator exposing domain repositories.
 * @param {string} deps.userId - Local user identifier.
 * @param {Function} [deps.onProgress] - Optional progress callback `(phase: string, detail: object) => void`.
 * @returns {Promise<{ applied: { readState: number, deviceState: number, starredItems: number }, cursor: number, fullResync: boolean }>} Sync execution result.
 */
export async function runUserScopedSync(deps) {
  const { api, storage, repos, userId, onProgress } = deps

  const since_seq = (await storage.meta.get('last_user_seq')) ?? 0

  if (typeof onProgress === 'function') {
    onProgress('fetch', { since_seq })
  }

  const response = await api.get('/users/me/sync', { query: { since_seq } })

  if (response && response.full_resync_required === true) {
    await storage.meta.set('last_user_seq', 0)
    return {
      applied: { readState: 0, deviceState: 0, starredItems: 0 },
      cursor: 0,
      fullResync: true
    }
  }

  const readStateRows = response?.read_state ?? []
  const deviceStateRows = response?.device_state ?? []
  const starredItemsRows = response?.starred_items ?? []

  const readStateResult = await applyReadState({ repos, userId, rows: readStateRows })
  if (typeof onProgress === 'function') {
    onProgress('apply-read-state', readStateResult)
  }

  const deviceResult = await applyDeviceState({ repos, userId, rows: deviceStateRows })
  if (typeof onProgress === 'function') {
    onProgress('apply-device-state', deviceResult)
  }

  const starredResult = await applyStarredItems({ repos, userId, rows: starredItemsRows })
  if (typeof onProgress === 'function') {
    onProgress('apply-starred', starredResult)
  }

  const nextCursor = response?.max_seq ?? since_seq
  await storage.meta.set('last_user_seq', nextCursor)
  if (typeof onProgress === 'function') {
    onProgress('store-cursor', { cursor: nextCursor })
  }

  return {
    applied: {
      readState: readStateResult.applied,
      deviceState: deviceResult.applied,
      starredItems: starredResult.applied
    },
    cursor: nextCursor,
    fullResync: false
  }
}
