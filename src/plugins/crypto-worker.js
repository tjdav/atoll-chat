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

          if (type === 'worker:ready') {
            isReady = true

            // Send worker:init message with baseUrl
            const baseUrl = pluginContext.config?.url || 'http://localhost:8090'
            worker.postMessage({
              type: 'worker:init',
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

          if (type === 'worker:initialized') {
            if (pluginContext.$bus) {
              pluginContext.$bus.emit('worker:initialized', payload)
            }
            return
          }

          if (!id && type === 'db:new_local_room') {
            if (pluginContext.$bus) {
              pluginContext.$bus.emit('db:new_local_room', payload)
            }
            return
          }

          if (!id && type === 'room:member_updated') {
            if (pluginContext.$bus) {
              pluginContext.$bus.emit('room:member_updated', payload)
            }
            return
          }

          if (!id && type === 'db:room_deleted') {
            if (pluginContext.$bus) {
              pluginContext.$bus.emit('db:room_deleted', payload)
            }
            return
          }

          // Background broadcasts (e.g., from decryption pipeline)
          if (!id && type === 'db:new_local_data') {
            // Access injected event bus from Phase 1
            if (pluginContext.$bus) {
              pluginContext.$bus.emit('db:new_local_data', payload)
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

        return () => {
          return {
            $worker
          }
        }
      }
    }
  })
}
