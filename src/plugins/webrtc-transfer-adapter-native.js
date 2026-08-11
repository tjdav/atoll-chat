/**
 * Native P2P WebRTC Transfer Adapter.
 * Integrates RTCPeerConnection with @capacitor/filesystem to read files chunk-by-chunk.
 */

/**
 * Creates an instance of the Native P2P WebRTC Transfer Adapter.
 *
 * @returns {object} The native WebRTC transfer adapter instance.
 */
export function createNativeRTCTransferAdapter () {
  const sessions = new Map()

  return {
    sessions,

    /**
     * Creates and initializes a new WebRTC transfer session.
     *
     * @param {string} localUuid - Unique identifier for the transfer session.
     * @param {boolean} isSender - Whether this instance is the sender.
     * @param {function} onSignal - Callback triggered when signaling events occur.
     * @param {function} onProgress - Callback triggered with transfer progress percent.
     * @param {function} onComplete - Callback triggered when the transfer completes successfully.
     * @param {function} onError - Callback triggered when an error occurs during transfer.
     * @param {Array<object>} iceServers - List of ICE/STUN/TURN servers to use.
     * @returns {object} The created transfer session configuration object.
     */
    createSession: (localUuid, isSender, onSignal, onProgress, onComplete, onError, iceServers) => {
      const pc = new RTCPeerConnection({ iceServers })

      const session = {
        localUuid,
        isSender,
        pc,
        dc: null,
        chunks: [],
        receivedBytes: 0,
        totalBytes: 0,
        filename: '',
        mimeType: '',
        offset: 0,
        isSending: false,
        onProgress,
        onComplete,
        onError
      }

      sessions.set(localUuid, session)

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          onSignal({
            type: 'p2p_ice_candidate',
            localUuid,
            candidate: event.candidate.toJSON()
          })
        }
      }

      const setupDataChannel = (dc) => {
        session.dc = dc
        dc.binaryType = 'arraybuffer'


        dc.onmessage = async (event) => {
          if (typeof event.data === 'string') {
            const dataStr = event.data.trim()
            if (dataStr.startsWith('{') && dataStr.endsWith('}')) {
              try {
                const msg = JSON.parse(dataStr)
                if (msg.type === 'start') {
                  session.totalBytes = msg.size
                  session.filename = msg.filename
                  session.mimeType = msg.mimeType
                  session.chunks = []
                  session.receivedBytes = 0
                }
              } catch (err) {
                if (onError) {
                  onError(err)
                } else {
                  throw err
                }
              }
            }
          } else {
            session.chunks.push(event.data)
            session.receivedBytes += event.data.byteLength

            if (onProgress && session.totalBytes > 0) {
              const progress = Math.min(100, Math.round((session.receivedBytes / session.totalBytes) * 100))
              onProgress(progress)
            }

            if (session.receivedBytes >= session.totalBytes && session.totalBytes > 0) {
              const blob = new Blob(session.chunks, { type: session.mimeType })
              dc.close()
              pc.close()
              sessions.delete(localUuid)
              if (onComplete) {
                onComplete(blob)
              }
            }
          }
        }

        dc.onclose = () => {
          pc.close()
          sessions.delete(localUuid)
        }

        dc.onerror = (err) => {
          pc.close()
          sessions.delete(localUuid)
          if (onError) {
            onError(err)
          }
        }
      }

      if (isSender) {
        const dc = pc.createDataChannel(`transfer-${localUuid}`)
        setupDataChannel(dc)
      } else {
        pc.ondatachannel = (event) => {
          setupDataChannel(event.channel)
        }
      }

      return session
    },

    /**
     * Starts an outgoing file transfer session.
     *
     * @param {string} localUuid - Unique identifier for the transfer session.
     * @param {File|Blob|string} file - The file/blob to transfer, or filepath string if native.
     * @param {number} [chunkSizeBytes=16384] - Size of each chunk to send in bytes.
     * @throws {Error} If no active data channel exists for the transfer session.
     * @returns {Promise<void>} Resolves when the transfer is successfully initiated.
     */
    startOutgoing: async (localUuid, file, chunkSizeBytes) => {
      const session = sessions.get(localUuid)
      if (!session || !session.dc) {
        throw new Error('No active data channel for outgoing transfer')
      }

      const dc = session.dc
      const chunkSize = chunkSizeBytes || 16384
      let offset = 0

      const totalSize = (typeof file === 'string') ? session.totalBytes : file.size

      dc.send(JSON.stringify({
        type: 'start',
        localUuid,
        size: totalSize,
        filename: (typeof file === 'string') ? session.filename : file.name,
        mimeType: (typeof file === 'string') ? session.mimeType : file.type
      }))

      const bufferedAmountLowThreshold = 64 * 1024
      dc.bufferedAmountLowThreshold = bufferedAmountLowThreshold

      let Filesystem = null
      let Directory = null

      // Optional native-only imports use .catch() promise chain to prevent bundler unresolved import failures.
      const capFs = await import('@capacitor/filesystem').catch(() => null)

      if (capFs) {
        Filesystem = capFs.Filesystem
        Directory = capFs.Directory
      }

      if (Filesystem && Directory && typeof file === 'string') {
        const filePath = file
        while (offset < session.totalBytes) {
          if (dc.bufferedAmount > bufferedAmountLowThreshold) {
            await new Promise(resolve => {
              const onBufferedAmountLow = () => {
                dc.removeEventListener('bufferedamountlow', onBufferedAmountLow)
                resolve()
              }
              dc.addEventListener('bufferedamountlow', onBufferedAmountLow)
            })
          }

          const readResult = await Filesystem.readFile({
            path: filePath,
            directory: Directory.Data,
            length: chunkSize,
            offset: offset
          })

          const rawData = readResult.data
          const binaryString = atob(rawData)
          const len = binaryString.length
          const bytes = new Uint8Array(len)
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }

          dc.send(bytes.buffer)
          offset += bytes.byteLength

          if (session.onProgress && session.totalBytes > 0) {
            const progressPercent = Math.min(100, Math.round((offset / session.totalBytes) * 100))
            session.onProgress(progressPercent)
          }
        }
      } else {
        const blob = file
        while (offset < blob.size) {
          if (dc.bufferedAmount > bufferedAmountLowThreshold) {
            await new Promise(resolve => {
              const onBufferedAmountLow = () => {
                dc.removeEventListener('bufferedamountlow', onBufferedAmountLow)
                resolve()
              }
              dc.addEventListener('bufferedamountlow', onBufferedAmountLow)
            })
          }

          const chunk = blob.slice(offset, offset + chunkSize)
          const arrayBuffer = await chunk.arrayBuffer()
          dc.send(arrayBuffer)
          offset += arrayBuffer.byteLength

          if (session.onProgress && blob.size > 0) {
            const progressPercent = Math.min(100, Math.round((offset / blob.size) * 100))
            session.onProgress(progressPercent)
          }
        }
      }

      if (dc.bufferedAmount > 0) {
        dc.bufferedAmountLowThreshold = 0
        await new Promise(resolve => {
          const onBufferedAmountLow = () => {
            dc.removeEventListener('bufferedamountlow', onBufferedAmountLow)
            resolve()
          }
          dc.addEventListener('bufferedamountlow', onBufferedAmountLow)
        })
      }

      if (session.onComplete) {
        session.onComplete()
      }
    }
  }
}
