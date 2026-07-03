import { definePlugin } from 'coralite'

/**
 *
 */
export default function workerPlugin ({ url = 'http://localhost:8090' } = {}) {
  return definePlugin({
    name: 'cryptoWorker',
    client: {
      config: {
        url
      },
      context: (pluginContext) => {
        // Phase 1: Global Setup
        const worker = new Worker('/worker.js')
        const pendingRequests = new Map()
        let isReady = false
        const readyQueue = []

        worker.onmessage = (event) => {
          const { id, type, payload, result, error } = event.data

          if (type === 'WORKER_READY') {
            isReady = true

            // Send INIT message with baseUrl
            const baseUrl = pluginContext.config?.url || 'http://localhost:8090'
            worker.postMessage({
              type: 'INIT',
              payload: { baseUrl }
            })

            while (readyQueue.length > 0) {
              const { type, payload, resolve, reject, id } = readyQueue.shift()
              pendingRequests.set(id, {
                resolve,
                reject
              })
              worker.postMessage({
                id,
                type,
                payload
              })
            }
            return
          }

          if (!id && type === 'NEW_LOCAL_ROOM') {
            if (pluginContext.$bus) {
              pluginContext.$bus.emit('NEW_LOCAL_ROOM', payload)
            }
            return
          }

          if (!id && type === 'UPDATE_ROOM_MEMBER') {
            if (pluginContext.$bus) {
              pluginContext.$bus.emit('UPDATE_ROOM_MEMBER', payload)
            }
            return
          }

          // Background broadcasts (e.g., from decryption pipeline)
          if (!id && type === 'NEW_LOCAL_DATA') {
            // Access injected event bus from Phase 1
            if (pluginContext.$bus) {
              pluginContext.$bus.emit('NEW_LOCAL_DATA', payload)
            }
            return
          }

          if (id && pendingRequests.has(id)) {
            const { resolve, reject } = pendingRequests.get(id)
            pendingRequests.delete(id)

            if (error) {
              reject(new Error(error))
            } else {
              resolve(result || payload)
            }
          }
        }

        worker.onerror = (error) => {
          console.error('Worker Error:', error)
          // Reject all pending requests on worker crash?
          for (const [id, { reject }] of pendingRequests) {
            reject(new Error('Worker crashed'))
            pendingRequests.delete(id)
          }
        }

        const $worker = {
          execute: (type, payload) => {
            return new Promise((resolve, reject) => {
              const id = crypto.randomUUID()

              if (!isReady) {
                readyQueue.push({
                  id,
                  type,
                  payload,
                  resolve,
                  reject
                })
              } else {
                pendingRequests.set(id, {
                  resolve,
                  reject
                })
                worker.postMessage({
                  id,
                  type,
                  payload
                })
              }
            })
          }
        }

        return (instanceContext) => {
          return {
            $worker
          }
        }
      }
    }
  })
}
