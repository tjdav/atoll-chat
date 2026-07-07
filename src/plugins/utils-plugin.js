import { definePlugin } from 'coralite'

/**
 * Utils Plugin for Atoll Chat
 * Provides common utility functions organized into namespaces.
 */

export default definePlugin({
  name: 'utils',
  client: {
    context: () => {
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
          const diffInSeconds = Math.floor((now - date) / 1000)

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
          const { $bus } = bus
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
       * Namespace: $image
       */
      const image = {
        /**
         * Compresses an image.
         */
        compress: async (source, options = {}) => {
          const {
            maxWidth = 1200,
            maxHeight = 1200,
            quality = 0.8,
            format = 'image/webp',
            cropToSquare = false
          } = options

          let img
          let shouldRevoke = false

          if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
            img = source
          } else {
            img = new Image()
            const promise = new Promise((resolve, reject) => {
              img.onload = () => resolve(img)
              img.onerror = () => reject(new Error('Failed to load image source'))
            })

            if (source instanceof Blob) {
              const url = URL.createObjectURL(source)
              img.src = url
              shouldRevoke = true
            } else {
              img.src = source
            }

            await promise
          }

          try {
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')

            let targetWidth = img.width
            let targetHeight = img.height

            if (cropToSquare) {
              const size = Math.min(targetWidth, targetHeight)
              let finalSize = size
              if (finalSize > maxWidth || finalSize > maxHeight) {
                finalSize = Math.min(maxWidth, maxHeight)
              }
              canvas.width = finalSize
              canvas.height = finalSize
              const sourceX = (img.width - size) / 2
              const sourceY = (img.height - size) / 2
              ctx.drawImage(img, sourceX, sourceY, size, size, 0, 0, finalSize, finalSize)
            } else {
              const ratio = Math.min(maxWidth / targetWidth, maxHeight / targetHeight, 1.0)
              targetWidth *= ratio
              targetHeight *= ratio
              canvas.width = targetWidth
              canvas.height = targetHeight
              ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
            }

            return new Promise((resolve, reject) => {
              canvas.toBlob((blob) => {
                if (blob) {
                  resolve(blob)
                } else {
                  reject(new Error('Canvas toBlob failed'))
                }
              }, format, quality)
            })
          } finally {
            if (shouldRevoke && img.src) {
              URL.revokeObjectURL(img.src)
            }
          }
        }
      }

      /**
       * Namespace: $video
       */
      const video = {
        /**
         * Extracts a thumbnail and duration from a video.
         */
        getMetadata: async (source) => {
          return new Promise((resolve, reject) => {
            const videoEl = document.createElement('video')
            videoEl.preload = 'metadata'
            videoEl.muted = true
            videoEl.playsInline = true
            let url
            if (source instanceof Blob) {
              url = URL.createObjectURL(source)
            } else {
              url = source
            }

            const cleanup = () => {
              if (source instanceof Blob) {
                URL.revokeObjectURL(url)
              }
              videoEl.remove()
            }

            videoEl.onloadedmetadata = () => {
              videoEl.currentTime = 0
            }
            videoEl.onseeked = () => {
              try {
                const canvas = document.createElement('canvas')
                canvas.width = videoEl.videoWidth
                canvas.height = videoEl.videoHeight
                const ctx = canvas.getContext('2d')
                ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
                resolve({
                  canvas,
                  duration: videoEl.duration
                })
                if (source instanceof Blob) {
                  URL.revokeObjectURL(url)
                }
                videoEl.remove()
              } catch (err) {
                reject(err)
                cleanup()
              }
            }
            videoEl.onerror = () => {
              reject(new Error('Failed to load video metadata')); cleanup()
            }
            videoEl.src = url
            videoEl.load()
          })
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

      const baseNamespaces = {
        $time: time,
        $string: string,
        $list: list,
        $func: func,
        $image: image,
        $video: video,
        $crypto: crypto
      }


      return (instanceContext) => {
        const { pocketbase, cryptoWorker, globalStore } = instanceContext

        /**
         * Namespace: $media
         */
        const media = {
          /**
           * Fetches an encrypted asset from PocketBase, decrypts it, and returns an Object URL.
           */
          decrypt: async (asset, signal) => {
            const { pb } = pocketbase
            const { $worker } = cryptoWorker
            const { $state } = globalStore
            const possibleKeys = [asset.message_id, asset.id, asset.media_id].filter(Boolean)
            for (const key of possibleKeys) {
              if ($state.decryptionCache.has(key)) {
                const cached = $state.decryptionCache.get(key)
                return typeof cached === 'string' ? cached : cached.blobUrl
              }
            }
            const mediaRecord = await pb.collection('media').getOne(asset.media_id)
            const url = pb.files.getURL(mediaRecord, mediaRecord.file)
            const response = await fetch(url, { signal })
            if (!response.ok) {
              throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`)
            }
            const encryptedBuffer = await response.arrayBuffer()
            if (signal?.aborted) {
              throw new DOMException('Aborted', 'AbortError')
            }
            const decryptedBuffer = await $worker.execute('worker:decrypt_file', {
              encryptedBuffer,
              nonce: asset.file_nonce,
              key: asset.file_key
            })
            if (signal?.aborted) {
              throw new DOMException('Aborted', 'AbortError')
            }
            const mediaBlob = new Blob([decryptedBuffer], { type: asset.mime_type })
            const objectUrl = URL.createObjectURL(mediaBlob)
            const cacheKey = asset.message_id || asset.id || asset.media_id
            if (cacheKey) {
              $state.decryptionCache.set(cacheKey, {
                blobUrl: objectUrl,
                mimeType: asset.mime_type
              })
            }
            return objectUrl
          }
        }

        return {
          ...baseNamespaces,
          $media: media
        }
      }
    }
  }
})
