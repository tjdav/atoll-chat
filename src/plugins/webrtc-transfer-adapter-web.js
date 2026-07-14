/**
 * Web P2P WebRTC Transfer Adapter.
 * Uses browser-native RTCPeerConnection and RTCDataChannel.
 */
export function createWebRTCTransferAdapter () {
  const sessions = new Map()

  return {
    sessions,

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
        isSending: false
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

        dc.onopen = () => {
          console.info(`[WebRTC-P2P] DataChannel opened for ${localUuid}`)
        }

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
                console.info(`[WebRTC-P2P] Incoming transfer started: ${session.filename} (${session.totalBytes} bytes)`)
              }
            } catch (err) {
              console.error('[WebRTC-P2P] Failed to parse string message:', err)
            }
          } else {
            session.chunks.push(event.data)
            session.receivedBytes += event.data.byteLength

            if (onProgress && session.totalBytes > 0) {
              const progress = Math.min(100, Math.round((session.receivedBytes / session.totalBytes) * 100))
              onProgress(progress)
            }

            if (session.receivedBytes >= session.totalBytes && session.totalBytes > 0) {
              console.info(`[WebRTC-P2P] Transfer complete for ${localUuid}`)
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
          console.info(`[WebRTC-P2P] DataChannel closed for ${localUuid}`)
          pc.close()
          sessions.delete(localUuid)
        }

        dc.onerror = (err) => {
          console.error(`[WebRTC-P2P] DataChannel error for ${localUuid}:`, err)
          pc.close()
          sessions.delete(localUuid)
          if (onError) onError(err)
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
      }
    }
  }
}
