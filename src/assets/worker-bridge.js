/**
 * Asynchronous messaging bridge between workers and the main thread storage plugin.
 */

/* global self */

const pendingRequests = new Map()
let requestIdCounter = 0

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

      self.postMessage({
        type: 'STORAGE_REQUEST',
        action,
        payload,
        requestId
      }, transferables || [])
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
