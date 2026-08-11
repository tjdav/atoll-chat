/**
 * Web P2P WebRTC Transfer Adapter.
 * Uses browser-native RTCPeerConnection and RTCDataChannel.
 */

/**
 * Creates an instance of the Web P2P WebRTC Transfer Adapter.
 *
 * @returns {object} The Web WebRTC transfer adapter instance.
 */
export function createWebRTCTransferAdapter () {
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

      /**
       * Configures and binds event listeners for the WebRTC Data Channel.
       *
       * @param {RTCDataChannel} dc - The data channel to setup.
       * @returns {void}
       */
      const setupDataChannel = (dc) => {
        session.dc = dc
        dc.binaryType = 'arraybuffer'

        dc.onmessage = async (event) => {
          if (typeof event.data === 'string') {
            try {
              const msg = JSON.parse(event.data)
              if (msg.type === 'start') {
                session.totalBytes = msg.size
                session.filename = msg.filename
                session.mimeType = msg.mimeType
                session.chunks = []
                session.receivedBytes = 0
              }
            } catch (err) {
              if (session.onError) {
                session.onError(err)
              } else {
                throw err
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
     * @param {File|Blob} file - The file/blob to transfer.
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

      dc.send(JSON.stringify({
        type: 'start',
        localUuid,
        size: file.size,
        filename: file.name,
        mimeType: file.type
      }))

      const bufferedAmountLowThreshold = 64 * 1024
      dc.bufferedAmountLowThreshold = bufferedAmountLowThreshold

      while (offset < file.size) {
        if (dc.bufferedAmount > bufferedAmountLowThreshold) {
          await new Promise(resolve => {
            const onBufferedAmountLow = () => {
              dc.removeEventListener('bufferedamountlow', onBufferedAmountLow)
              resolve()
            }
            dc.addEventListener('bufferedamountlow', onBufferedAmountLow)
          })
        }

        const chunk = file.slice(offset, offset + chunkSize)
        const arrayBuffer = await chunk.arrayBuffer()
        dc.send(arrayBuffer)
        offset += arrayBuffer.byteLength

        if (session.onProgress) {
          const progressPercent = Math.min(100, Math.round((offset / file.size) * 100))
          session.onProgress(progressPercent)
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
