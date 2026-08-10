/**
 * Asynchronous messaging bridge between workers and the main thread storage plugin.
 */

/* global self */

const pendingRequests = new Map()
let requestIdCounter = 0

/**
 * Traverses an object or array to extract all transferable objects (ArrayBuffer or ArrayBuffer views).
 * Safely handles circular references and ignores non-serializable properties or expected errors.
 *
 * @param {any} obj The input object or array to extract transferables from.
 * @param {Set<any>} [seen] A set containing already visited objects to prevent infinite recursion.
 * @returns {ArrayBuffer[]} An array of extracted ArrayBuffer transferable objects.
 * @throws {Error} Re-throws unexpected critical system errors that are not standard property access or type errors.
 */
function getTransferables (obj, seen = new Set()) {
  if (!obj || typeof obj !== 'object') {
    return []
  }
  if (seen.has(obj)) {
    return []
  }
  seen.add(obj)

  const transferables = []

  if (obj instanceof ArrayBuffer) {
    transferables.push(obj)
  } else if (ArrayBuffer.isView(obj) && obj.buffer instanceof ArrayBuffer) {
    transferables.push(obj.buffer)
  } else {
    try {
      const keys = Object.keys(obj)
      for (let i = 0; i < keys.length; i++) {
        const val = obj[keys[i]]
        if (val && typeof val === 'object') {
          transferables.push(...getTransferables(val, seen))
        }
      }
    } catch (err) {
      // Handle standard expected errors when attempting to serialize or access non-serializable properties/proxies.
      if (err instanceof TypeError || err.name === 'SecurityError' || err.name === 'TypeError') {
        return transferables
      }
      throw err
    }
  }

  return Array.from(new Set(transferables))
}

self.workerBridge = {
  /**
   * Sends an asynchronous storage request to the main thread.
   * @param {string} action The storage adapter action to perform.
   * @param {any} payload The raw payload for the action.
   * @param {ArrayBuffer[]} [transferables] Optional transferable objects.
   * @returns {Promise<any>} A promise that resolves with the storage operation result.
   */
  request (action, payload, transferables) {
    return new Promise((resolve, reject) => {
      const requestId = 'msg_' + (requestIdCounter++)
      pendingRequests.set(requestId, {
        resolve,
        reject
      })

      const msg = {
        type: 'STORAGE_REQUEST',
        action,
        payload,
        requestId
      }
      const collected = getTransferables(msg)
      if (transferables && Array.isArray(transferables)) {
        for (const t of transferables) {
          if (t instanceof ArrayBuffer && !collected.includes(t)) {
            collected.push(t)
          }
        }
      }

      self.postMessage(msg, collected)
    })
  }
}

self.addEventListener('message', (event) => {
  const { type, requestId, result, error } = event.data

  if (type === 'STORAGE_RESPONSE' && requestId) {
    const pending = pendingRequests.get(requestId)
    if (pending) {
      pendingRequests.delete(requestId)
      if (error) {
        pending.reject(new Error(error))
      } else {
        pending.resolve(result)
      }
    }
  }
})
