import { definePlugin } from 'coralite'

/**
 *
 */
export default function workerPlugin ({ url = '/', appUrl = '' } = {}) {
  return definePlugin({
    name: 'cryptoWorker',
    client: {
      config: {
        url,
        appUrl
      },
      context: (pluginContext) => {
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
            } catch (_) {
              // ignore non-serializable properties or errors
            }
          }

          return Array.from(new Set(transferables))
        }

        // Phase 1: Global Setup
        const worker = new Worker('/worker.js')
        const pendingRequests = new Map()
        let isReady = false
        const readyQueue = []

        if (typeof pluginContext.registerStorageWorker === 'function') {
          pluginContext.registerStorageWorker(worker)
        }

        worker.onmessage = (event) => {
          const { id, type, payload, result, error } = event.data

          if (type === 'worker:ready') {
            isReady = true

            // Send worker:init message with baseUrl
            const cfg = pluginContext.config || {}
            let baseUrl = cfg.url || '/'
            if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
              if (cfg.appUrl) {
                baseUrl = cfg.appUrl
              } else if (baseUrl === '/' || baseUrl.startsWith('http:') || baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
                baseUrl = baseUrl.replace(/^http:\/\//, 'https://').replace(/:8090$/, ':3443')
              }
            }
            const initMsg = {
              type: 'worker:init',
              payload: { baseUrl }
            }
            worker.postMessage(initMsg, getTransferables(initMsg))

            while (readyQueue.length > 0) {
              const { type, payload, resolve, reject, id } = readyQueue.shift()
              pendingRequests.set(id, {
                resolve,
                reject
              })
              const msg = {
                id,
                type,
                payload
              }
              worker.postMessage(msg, getTransferables(msg))
            }
            return
          }

          if (!id && type === 'sync:message_replayed') {
            if (pluginContext.$bus) {
              pluginContext.$bus.emit('sync:message_replayed', payload)
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
                const msg = {
                  id,
                  type,
                  payload
                }
                worker.postMessage(msg, getTransferables(msg))
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
