import { definePlugin } from 'coralite'

/**
 * Utils Plugin for Atoll Chat
 * Provides common utility functions organized into namespaces.
 */

export default definePlugin({
  name: 'utils',
  client: {
    context: async () => {
      const { normalizeUrl } = await import('../utils/url.js')

      /**
       * Namespace: $time
       */
      const time = {
        /**
         * Converts exact DB timestamps to abbreviated relative formats.
         */
        getRelative: (timestamp) => {
          if (!timestamp) {
            return ''
          }
          const date = new Date(timestamp)
          const now = new Date()
          const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

          if (diffInSeconds < 60) {
            return 'now'
          }

          const diffInMinutes = Math.floor(diffInSeconds / 60)
          if (diffInMinutes < 60) {
            return `${diffInMinutes}m`
          }

          const diffInHours = Math.floor(diffInMinutes / 60)
          if (diffInHours < 24) {
            return `${diffInHours}h`
          }

          const diffInDays = Math.floor(diffInHours / 24)
          if (diffInDays < 7) {
            return `${diffInDays}d`
          }

          const diffInWeeks = Math.floor(diffInDays / 7)
          if (diffInWeeks < 52) {
            return `${diffInWeeks}w`
          }

          const diffInYears = Math.floor(diffInDays / 365)
          return `${diffInYears}y`
        },

        /**
         * Formats duration in seconds to M:SS or H:MM:SS string.
         */
        formatDuration: (seconds) => {
          if (!seconds || isNaN(seconds)) {
            return '0:00'
          }
          const h = Math.floor(seconds / 3600)
          const m = Math.floor((seconds % 3600) / 60)
          const s = Math.floor(seconds % 60)
          const sStr = s.toString().padStart(2, '0')
          if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${sStr}`
          }
          return `${m}:${sStr}`
        }
      }

      /**
       * Namespace: $string
       */
      const string = {
        /**
         * Safely bounds strings with an ellipsis based on a character limit.
         */
        truncate: (str, limit = 160) => {
          if (!str || str.length <= limit) {
            return str || ''
          }
          return str.slice(0, limit).trim() + '...'
        }
      }

      /**
       * Namespace: $list
       */
      const list = {
        /**
         * Abstracts the duplicated debouncedRender and database cursor loops.
         */
        createManager: ({
          fetchNextBatch,
          render,
          scrollRoot,
          state,
          utils,
          globalStore,
          bus,
          listId,
          Fuse,
          searchKeys = ['searchContent']
        }) => {
          const { $state } = globalStore
          const { $bus: _ } = bus
          const { $func } = utils

          let loadedItems = []
          let lastItem = null
          let hasMore = true
          let isFetching = false
          let fuseInstance = null
          let lastIndexedCount = 0

          const manager = {
            get loadedItems () {
              return loadedItems
            },
            set loadedItems (val) {
              loadedItems = val
            },
            get lastItem () {
              return lastItem
            },
            set lastItem (val) {
              lastItem = val
            },
            get hasMore () {
              return hasMore
            },
            set hasMore (val) {
              hasMore = val
            },

            fetch: async () => {
              if (!hasMore || isFetching) {
                return
              }
              isFetching = true
              try {
                const { items, last } = await fetchNextBatch(lastItem)
                if (items.length === 0) {
                  hasMore = false
                } else {
                  lastItem = last || items[items.length - 1]
                  // Filter out duplicates based on ID
                  const newItems = items.filter(item => !loadedItems.some(existing => (existing.id || existing.item?.id) === (item.id || item.item?.id)))
                  loadedItems = [...loadedItems, ...newItems]
                }
              } finally {
                isFetching = false
              }
            },

            performRender: async () => {
              if (loadedItems.length === 0 && hasMore) {
                await manager.fetch()
              }

              let itemsToDisplay = loadedItems
              const query = ($state.listSearchQuery || '').trim().toLowerCase()

              if (query && Fuse) {
                if (!fuseInstance || lastIndexedCount !== loadedItems.length) {
                  fuseInstance = new Fuse(loadedItems, {
                    keys: searchKeys,
                    threshold: 0.4
                  })
                  lastIndexedCount = loadedItems.length
                }
                itemsToDisplay = fuseInstance.search(query).map(r => r.item)
              }

              await render(itemsToDisplay, query)

              // Restore scroll
              if (!state.__scrollRestored && $state.listScrollPositions?.[listId] !== undefined) {
                setTimeout(() => {
                  if (scrollRoot) {
                    scrollRoot.scrollTop = $state.listScrollPositions[listId]
                  }
                }, 50)
                state.__scrollRestored = true
              }
            },

            saveScroll: () => {
              if (!scrollRoot || (scrollRoot.offsetWidth === 0 && scrollRoot.offsetHeight === 0)) {
                return
              }
              if (!$state.listScrollPositions) {
                $state.listScrollPositions = {}
              }
              $state.listScrollPositions[listId] = scrollRoot.scrollTop
            },

            reset: () => {
              loadedItems = []
              lastItem = null
              hasMore = true
              fuseInstance = null
              lastIndexedCount = 0
            }
          }

          const debouncedRender = $func.debounce(() => manager.performRender(), 50)
          const debouncedSaveScroll = $func.debounce(() => manager.saveScroll(), 100)

          if (scrollRoot) {
            scrollRoot.onscroll = async () => {
              if (scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 50 && hasMore) {
                await manager.fetch()
                manager.performRender()
              }
              debouncedSaveScroll()
            }
          }

          return {
            manager,
            debouncedRender,
            debouncedSaveScroll
          }
        }
      }

      /**
       * Namespace: $func
       */
      const func = {
        /**
         * Creates a debounced function that delays invoking func until after wait milliseconds.
         */
        debounce: (fn, wait) => {
          let timeoutId
          return (...args) => {
            clearTimeout(timeoutId)
            timeoutId = setTimeout(() => {
              fn.apply(this, args)
            }, wait)
          }
        }
      }

      /**
       * Namespace: $crypto
       * Provides native browser-based encoding and decoding helpers.
       * Does NOT include Libsodium.
       */
      const crypto = {
        toBase64: (uint8Array) => {
          let binary = ''
          const len = uint8Array.byteLength
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(uint8Array[i])
          }
          return btoa(binary)
        },
        fromBase64: (base64) => {
          const binaryString = atob(base64)
          const len = binaryString.length
          const bytes = new Uint8Array(len)
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }
          return bytes
        },
        toUint8Array: (str) => new TextEncoder().encode(str),
        toString: (uint8Array) => new TextDecoder().decode(uint8Array)
      }

      /**
       * Namespace: $device
       */
      const device = {
        /**
         * Checks if the device has a touch screen.
         */
        isTouch: () => {
          return window.matchMedia('(pointer: coarse)').matches
        }
      }

      /**
       * Namespace: $url
       */
      const url = {
        /**
         * Normalizes a base URL and/or path into a valid, safe URL.
         * Prevents protocol-relative "//" URL traps when relative paths (like "/") are used.
         */
        normalizeUrl
      }

      const baseNamespaces = {
        $time: time,
        $string: string,
        $list: list,
        $func: func,
        $crypto: crypto,
        $device: device,
        $url: url
      }


      return (instanceContext) => {
        const { pocketbase, cryptoWorker, globalStore, storage, eventBus } = instanceContext
        const { $storage } = storage
        const { $bus } = eventBus || {}

        const inFlightDecryptions = new Map()

        if ($bus) {
          $bus.on('auth:logout', () => {
            inFlightDecryptions.clear()
          })
        }

        /**
         * Resolves strict canonical cache key for a media asset.
         */
        const resolveCanonicalKey = (asset = {}, options = {}) => {
          if (typeof asset === 'string') {
            return asset
          }
          if (options.cacheKey) {
            return options.cacheKey
          }
          if (asset.cacheKey) {
            return asset.cacheKey
          }

          const isThumbnail = !!(options.isThumbnail || asset.isThumbnail)
          const isLocal = !!(options.isLocal || asset.isLocal || (asset.localUuid && !asset.media_id && !asset.file_key))
          const id = asset.media_id || asset.attachmentId || asset.id || asset.localUuid || asset.message_id || 'unknown'

          if (isLocal) {
            return `local:${asset.localUuid || id}`
          }
          if (isThumbnail) {
            return `thumb:${id}`
          }
          return `media:${id}`
        }

        /**
         * Attaches caller-isolated AbortSignal listener to a promise.
         */
        const attachSignal = (promise, signal) => {
          if (!signal) {
            return promise
          }
          if (signal.aborted) {
            return Promise.reject(new DOMException('Aborted', 'AbortError'))
          }
          return new Promise((resolve, reject) => {
            const onAbort = () => {
              reject(new DOMException('Aborted', 'AbortError'))
            }
            signal.addEventListener('abort', onAbort, { once: true })

            promise.then(
              (res) => {
                signal.removeEventListener('abort', onAbort)
                resolve(res)
              },
              (err) => {
                signal.removeEventListener('abort', onAbort)
                reject(err)
              }
            )
          })
        }


        /**
         * Helper to decrypt encrypted file buffers in Web Worker scope.
         */
        const decryptPayloadInWorker = async ($worker, encryptedBuffer, nonce, key) => {
          if (nonce === 'AES-GCM') {
            return $worker.execute('worker:decrypt_link_preview', {
              encryptedBuffer,
              nonce,
              key
            })
          }
          return $worker.execute('worker:crypto_secretbox_open_easy', {
            ciphertext: encryptedBuffer,
            nonce,
            key
          })
        }

        /**
         * Namespace: $media
         */
        const media = {
          /**
           * Fetches an encrypted asset from PocketBase, decrypts it using the crypto worker, and returns an Object URL.
           * Uses strict canonical cache keys and in-flight promise memoization to deduplicate requests.
           *
           * @param {Object|string} asset - The encrypted asset metadata containing keys, nonces, and media identifiers.
           * @param {Object|AbortSignal} [optionsOrSignal] - Options object ({ signal, isThumbnail, cacheKey, isLocal }) or AbortSignal.
           * @returns {Promise<string>} A promise resolving to the decrypted object URL.
           */
          decrypt: async (asset, optionsOrSignal) => {
            const { pb } = pocketbase
            const { $worker } = cryptoWorker
            const { $state } = globalStore

            if (asset && asset.dataUrl) {
              return asset.dataUrl
            }

            let options = {}
            if (optionsOrSignal) {
              if (optionsOrSignal instanceof AbortSignal || typeof optionsOrSignal.addEventListener === 'function') {
                options = { signal: optionsOrSignal }
              } else {
                options = optionsOrSignal
              }
            }
            const signal = options.signal

            const canonicalKey = resolveCanonicalKey(asset, options)

            // Synchronous cache lookup
            if ($state.decryptionCache.has(canonicalKey)) {
              const cached = $state.decryptionCache.get(canonicalKey)
              return typeof cached === 'string' ? cached : cached.blobUrl
            }

            // In-flight memoization lookup
            if (inFlightDecryptions.has(canonicalKey)) {
              return attachSignal(inFlightDecryptions.get(canonicalKey), signal)
            }

            // Start background decryption job
            const decryptionPromise = (async () => {
              let encryptedBuffer
              const fileId = asset.localUuid || asset.message_id || asset.id || asset.media_id
              const localFile = fileId ? await $storage.getFile(fileId) : null
              const nonce = asset.file_nonce || asset.nonce
              const key = asset.file_key || asset.key
              const mimeType = asset.mime_type || asset.mimeType || 'image/jpeg'

              let decryptedBuffer = null

              if (localFile) {
                try {
                  encryptedBuffer = await localFile.arrayBuffer()
                  decryptedBuffer = await decryptPayloadInWorker($worker, encryptedBuffer, nonce, key)
                } catch (localDecryptError) {
                  console.warn(`[media] Local decryption failed for ${fileId}, falling back to remote URL:`, localDecryptError)
                  if (fileId) {
                    await $storage.deleteFile(fileId)
                  }
                  decryptedBuffer = null
                }
              }

              if (!decryptedBuffer) {
                if (asset.media_id) {
                  const mediaRecord = await pb.collection('media').getOne(asset.media_id)
                  const url = pb.files.getURL(mediaRecord, mediaRecord.file)
                  const response = await fetch(url)
                  if (!response.ok) {
                    throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`)
                  }
                  const remoteBlob = typeof response.blob === 'function' ? await response.blob() : new Blob([await response.arrayBuffer()])
                  encryptedBuffer = await remoteBlob.arrayBuffer()
                  decryptedBuffer = await decryptPayloadInWorker($worker, encryptedBuffer, nonce, key)

                  if (decryptedBuffer && fileId && typeof $storage.saveFile === 'function') {
                    await $storage.saveFile(fileId, remoteBlob)
                  }
                } else {
                  throw new Error('Media file not found locally or on server')
                }
              }

              if (!decryptedBuffer) {
                throw new Error('Decryption failed')
              }

              const mediaBlob = new Blob([decryptedBuffer], { type: mimeType })
              const objectUrl = URL.createObjectURL(mediaBlob)

              const roomId = options.roomId || (typeof asset === 'object' && asset ? asset.roomId : null) || $state.activeSelectionId

              if ($state.decryptionCache?.isTornDown) {
                try {
                  URL.revokeObjectURL(objectUrl)
                } catch {
                }
                throw new Error('Session terminated during decryption')
              }

              $state.decryptionCache.set(canonicalKey, {
                blobUrl: objectUrl,
                blob: mediaBlob,
                mimeType,
                roomId
              })

              return objectUrl
            })().finally(() => {
              inFlightDecryptions.delete(canonicalKey)
            })

            inFlightDecryptions.set(canonicalKey, decryptionPromise)

            return attachSignal(decryptionPromise, signal)
          },

          /**
           * Alias for $media.decrypt
           */
          getDecryptedMedia: (...args) => media.decrypt(...args),

          /**
           * Generates a theme-aware SVG waveform for any audio file.
           */
          generateWaveform: async (file) => {
            if (!file || (!file.type?.startsWith('audio/') && !file.name?.match(/\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i))) {
              return null
            }
            if (file.size > 20 * 1024 * 1024) {
              console.warn('[utils-plugin] Audio file too large for waveform generation:', file.size)
              return null
            }

            try {
              // Read file as ArrayBuffer with fallback to FileReader
              let arrayBuffer
              if (typeof file.arrayBuffer === 'function') {
                arrayBuffer = await file.arrayBuffer()
              } else {
                arrayBuffer = await new Promise((resolve, reject) => {
                  const reader = new FileReader()
                  reader.onload = () => resolve(reader.result)
                  reader.onerror = () => reject(reader.error)
                  reader.readAsArrayBuffer(file)
                })
              }

              let normalizedPeaks = []
              /** @type {any} */
              let audioContext = null
              try {
                /**
                 * @typedef {Object} CustomWindow
                 * @property {any} [webkitAudioContext]
                 */
                /** @type {CustomWindow & typeof globalThis} */
                const win = window
                const AudioContextClass = win.AudioContext || win.webkitAudioContext
                if (AudioContextClass) {
                  audioContext = new AudioContextClass()
                  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
                  const channelData = audioBuffer.getChannelData(0)
                  const barCount = 100
                  const chunkSize = Math.floor(channelData.length / barCount)
                  const peaks = []
                  let maxPeak = 0
                  for (let i = 0; i < barCount; i++) {
                    const start = i * chunkSize
                    const end = start + chunkSize
                    let peak = 0
                    for (let j = start; j < end; j++) {
                      const val = Math.abs(channelData[j])
                      if (val > peak) {
                        peak = val
                      }
                    }
                    peaks.push(peak)
                    if (peak > maxPeak) {
                      maxPeak = peak
                    }
                  }
                  normalizedPeaks = peaks.map(p => Math.max(0.05, maxPeak > 0 ? p / maxPeak : 0))
                }
              } catch {
                // Fallback: Byte-based pseudo-waveform for environments where Web Audio decodeAudioData fails (e.g. headless)
                const bytes = new Uint8Array(arrayBuffer)
                const barCount = 100
                const step = Math.floor(bytes.length / barCount) || 1
                const peaks = []
                let maxPeak = 0
                for (let i = 0; i < barCount; i++) {
                  const val = bytes[(i * step) % bytes.length] || 0
                  peaks.push(val)
                  if (val > maxPeak) {
                    maxPeak = val
                  }
                }
                normalizedPeaks = peaks.map(p => Math.max(0.1, maxPeak > 0 ? p / maxPeak : 0.2))
              } finally {
                if (audioContext && audioContext.state !== 'closed') {
                  try {
                    if (typeof audioContext.close === 'function') {
                      await audioContext.close()
                    }
                  } catch (closeErr) {
                    console.warn('[utils-plugin] Error closing audioContext:', closeErr)
                  }
                }
              }

              if (normalizedPeaks.length === 0) {
                const barCount = 100
                normalizedPeaks = Array(barCount).fill(0.2)
              }

              // Build SVG
              const height = 40
              const barWidth = 3
              const gap = 1

              const rects = normalizedPeaks.map((amp, i) => {
                const barHeight = amp * height
                const x = i * (barWidth + gap)
                const y = (height - barHeight) / 2
                return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="1.5" ry="1.5" fill="currentColor" />`
              }).join('')

              const svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 40" preserveAspectRatio="none">${rects}</svg>`
              return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgString)
            } catch (err) {
              console.warn('[utils-plugin] Waveform generation failed:', err)
              return null
            }
          }
        }

        /**
         * Namespace: $link
         */
        const link = {
          /**
           * Decrypts link preview image delegating to $media.decrypt.
           */
          decryptPreview: (asset, optionsOrSignal) => {
            let options = {}
            if (optionsOrSignal) {
              if (optionsOrSignal instanceof AbortSignal || typeof optionsOrSignal.addEventListener === 'function') {
                options = { signal: optionsOrSignal }
              } else {
                options = optionsOrSignal
              }
            }
            return media.decrypt(asset, { isThumbnail: true, ...options })
          }
        }

        return {
          ...baseNamespaces,
          $media: media,
          $link: link
        }
      }
    }
  }
})
