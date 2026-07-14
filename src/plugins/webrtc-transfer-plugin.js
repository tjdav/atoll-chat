import { definePlugin } from 'coralite'

/**
 * Platform-agnostic P2P WebRTC Transfer Gateway Plugin.
 * Orchestrates direct device-to-device file transfers.
 */
export default definePlugin({
  name: 'webrtcTransfer',
  client: {
    context: async (pluginContext) => {
      let resolvedAdapter = null

      const getAdapter = async () => {
        if (resolvedAdapter) {
          return resolvedAdapter
        }

        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            console.info('[webrtcTransfer] Native platform detected. Loading Native adapter.')
            const { createNativeRTCTransferAdapter } = await import('./webrtc-transfer-adapter-native.js')
            resolvedAdapter = createNativeRTCTransferAdapter()
            return resolvedAdapter
          }
        } catch (err) {
          // Fall back gracefully to Web adapter
        }

        console.info('[webrtcTransfer] Web platform detected. Loading Web adapter.')
        const { createWebRTCTransferAdapter } = await import('./webrtc-transfer-adapter-web.js')
        resolvedAdapter = createWebRTCTransferAdapter()
        return resolvedAdapter
      }

      const initialAdapter = await getAdapter()

      const pendingCandidates = new Map()

      return (instanceContext) => {
        const { globalStore, eventBus, cryptoWorker, storage, config } = instanceContext
        const { $state } = globalStore
        const { $bus } = eventBus
        const { $worker } = cryptoWorker
        const { $storage } = storage
        const { $config } = config

        const sendSignalingMessage = async (roomId, type, payload = {}) => {
          const localUuid = crypto.randomUUID()
          await $worker.execute('worker:send_message', {
            room_id: roomId,
            localUuid,
            type,
            ...payload,
            timestamp: Date.now()
          })
        }

        const scanAndInitiateHandshakes = async () => {
          if (!$state.isOnline || !$state.currentUser) {
            return
          }

          try {
            const rooms = await $storage.getAllRoomsSorted()
            for (const room of rooms) {
              const msgs = await $storage.getMessagesByRoom(room.id)
              const pendingP2P = msgs.filter(m => m.type === 'media' && m.transfer_mode === 'p2p' && m.status === 'pending_p2p' && m.sender_id !== $state.currentUser?.id)

              for (const msg of pendingP2P) {
                const file = await $storage.getFile(msg.local_uuid)
                if (!file) {
                  console.info(`[webrtcTransfer] Retrying pending P2P handshake for ${msg.local_uuid}`)
                  await sendSignalingMessage(room.id, 'p2p_request_offer', {
                    target_id: msg.sender_id,
                    p2pUuid: msg.local_uuid
                  })
                }
              }
            }
          } catch (err) {
            console.error('[webrtcTransfer] Error scanning for pending P2P:', err)
          }
        }

        $bus.on('app:network_change', (payload) => {
          if (payload.isOnline) {
            scanAndInitiateHandshakes().catch(console.error)
          }
        })

        $bus.on('app:foreground', () => {
          scanAndInitiateHandshakes().catch(console.error)
        })

        $bus.on('sync:complete', () => {
          scanAndInitiateHandshakes().catch(console.error)
        })

        $bus.on('db:new_local_data', async (payload) => {
          const { room_id: roomId, message } = payload
          if (!message) {
            return
          }
          console.info('[webrtcTransfer] db:new_local_data message:', message)

          if (message.sender_id === $state.currentUser?.id) {
            if (message.type !== 'media' || message.status !== 'pending_p2p') {
              return
            }
          }

          if (['p2p_request_offer', 'p2p_offer', 'p2p_answer', 'p2p_ice_candidate'].includes(message.type)) {
            if (message.created_at) {
              const isoStr = message.created_at.replace(' ', 'T')
              const finalStr = isoStr.endsWith('Z') ? isoStr : isoStr + 'Z'
              const msgTime = new Date(finalStr).getTime()
              if (isNaN(msgTime) || Math.abs(Date.now() - msgTime) > 300000) {
                return
              }
            }
          }

          if (message.type === 'media' && message.transfer_mode === 'p2p' && message.status === 'pending_p2p' && message.sender_id !== $state.currentUser?.id) {
            console.info(`[webrtcTransfer] Bob detected incoming P2P transfer request for ${message.local_uuid}`)

            const existingFile = await $storage.getFile(message.local_uuid)
            if (existingFile) {
              console.info(`[webrtcTransfer] File already exists locally for ${message.local_uuid}`)
              await $storage.updateMessage(message.local_uuid, { status: 'sent' }, roomId)
              return
            }

            await sendSignalingMessage(roomId, 'p2p_request_offer', {
              target_id: message.sender_id,
              p2pUuid: message.local_uuid
            })
          }

          if (message.type === 'p2p_request_offer' && message.target_id === $state.currentUser?.id) {
            const p2pUuid = message.p2pUuid
            console.info(`[webrtcTransfer] Alice received p2p_request_offer for ${p2pUuid} from ${message.sender_id}`)

            const fileObj = await $storage.getFile(p2pUuid)
            if (!fileObj) {
              console.error(`[webrtcTransfer] Alice could not find local file for ${p2pUuid}`)
              return
            }

            let file = fileObj
            if (fileObj.file) {
              file = fileObj.file
            }

            const iceServers = $config ? $config.get('iceServers') : undefined
            const chunkSizeBytes = $config ? $config.get('webrtcChunkSizeBytes') : 16384

            const onSignal = async (sig) => {
              await sendSignalingMessage(roomId, sig.type, {
                target_id: message.sender_id,
                p2pUuid,
                content: sig.content,
                candidate: sig.candidate
              })
            }

            const onProgress = (progress) => {
              $bus.emit('webrtc:transfer_progress', { localUuid: p2pUuid, progress })
            }

            const onComplete = () => {
              console.info(`[webrtcTransfer] Sender transfer complete for ${p2pUuid}`)
            }

            const onError = (err) => {
              console.error(`[webrtcTransfer] Sender transfer error for ${p2pUuid}:`, err)
            }

            const session = initialAdapter.createSession(
              p2pUuid,
              true,
              onSignal,
              onProgress,
              onComplete,
              onError,
              iceServers
            )

            session.fileToSend = file
            session.chunkSizeBytes = chunkSizeBytes

            const offer = await session.pc.createOffer()
            await session.pc.setLocalDescription(offer)

            await sendSignalingMessage(roomId, 'p2p_offer', {
              target_id: message.sender_id,
              p2pUuid,
              content: offer
            })

            const originalOnOpen = session.dc.onopen
            session.dc.onopen = async () => {
              if (originalOnOpen) {
                originalOnOpen()
              }
              console.info(`[webrtcTransfer] Starting file transfer for ${p2pUuid}`)
              try {
                await initialAdapter.startOutgoing(p2pUuid, session.fileToSend, session.chunkSizeBytes)
              } catch (err) {
                console.error('[webrtcTransfer] Failed to start outgoing transfer:', err)
              }
            }
          }

          if (message.type === 'p2p_offer' && message.target_id === $state.currentUser?.id) {
            const p2pUuid = message.p2pUuid
            console.info(`[webrtcTransfer] Bob received p2p_offer for ${p2pUuid} from ${message.sender_id}`)

            const iceServers = $config ? $config.get('iceServers') : undefined

            const onSignal = async (sig) => {
              await sendSignalingMessage(roomId, sig.type, {
                target_id: message.sender_id,
                p2pUuid,
                content: sig.content,
                candidate: sig.candidate
              })
            }

            const onProgress = (progress) => {
              $bus.emit('webrtc:transfer_progress', { localUuid: p2pUuid, progress })
            }

            const onComplete = async (blob) => {
              console.info(`[webrtcTransfer] Receiver transfer completed for ${p2pUuid}`)

              await $storage.saveFile(p2pUuid, blob)

              const localMsg = await $storage.getMessage(p2pUuid)
              if (localMsg) {
                await $storage.updateMessage(p2pUuid, { status: 'sent' }, roomId)

                await $storage.saveAsset({
                  id: localMsg.media_id || p2pUuid,
                  media_id: localMsg.media_id || p2pUuid,
                  room_id: roomId,
                  message_id: p2pUuid,
                  filename: localMsg.filename,
                  mime_type: localMsg.mime_type,
                  file_key: localMsg.file_key,
                  file_nonce: localMsg.file_nonce,
                  created_at: localMsg.created_at || new Date().toISOString(),
                  music_metadata: localMsg.music_metadata,
                  album_art: localMsg.album_art,
                  thumbnail: localMsg.thumbnail,
                  duration: localMsg.duration
                })
              }

              $bus.emit('db:new_local_data', {
                room_id: roomId,
                message: {
                  local_uuid: p2pUuid,
                  status: 'sent'
                }
              })
              $bus.emit('webrtc:transfer_complete', { localUuid: p2pUuid, blob })
            }

            const onError = (err) => {
              console.error(`[webrtcTransfer] Receiver transfer error for ${p2pUuid}:`, err)
            }

            const session = initialAdapter.createSession(
              p2pUuid,
              false,
              onSignal,
              onProgress,
              onComplete,
              onError,
              iceServers
            )

            await session.pc.setRemoteDescription(new RTCSessionDescription(message.content))

            const pending = pendingCandidates.get(p2pUuid) || []
            while (pending.length > 0) {
              const candidate = pending.shift()
              try {
                await session.pc.addIceCandidate(new RTCIceCandidate(candidate))
              } catch (err) {
                console.error('[webrtcTransfer] Failed to add replayed candidate:', err)
              }
            }
            pendingCandidates.delete(p2pUuid)

            const answer = await session.pc.createAnswer()
            await session.pc.setLocalDescription(answer)

            await sendSignalingMessage(roomId, 'p2p_answer', {
              target_id: message.sender_id,
              p2pUuid,
              content: answer
            })
          }

          if (message.type === 'p2p_answer' && message.target_id === $state.currentUser?.id) {
            const p2pUuid = message.p2pUuid
            console.info(`[webrtcTransfer] Alice received p2p_answer for ${p2pUuid} from ${message.sender_id}`)
            const session = initialAdapter.sessions.get(p2pUuid)
            if (session) {
              await session.pc.setRemoteDescription(new RTCSessionDescription(message.content))

              const pending = pendingCandidates.get(p2pUuid) || []
              while (pending.length > 0) {
                const candidate = pending.shift()
                try {
                  await session.pc.addIceCandidate(new RTCIceCandidate(candidate))
                } catch (err) {
                  console.error('[webrtcTransfer] Failed to add replayed candidate:', err)
                }
              }
              pendingCandidates.delete(p2pUuid)
            }
          }

          if (message.type === 'p2p_ice_candidate' && message.target_id === $state.currentUser?.id) {
            const p2pUuid = message.p2pUuid
            const candidate = message.candidate
            const session = initialAdapter.sessions.get(p2pUuid)
            if (session && session.pc.remoteDescription && session.pc.remoteDescription.type) {
              try {
                await session.pc.addIceCandidate(new RTCIceCandidate(candidate))
              } catch (err) {
                console.error('[webrtcTransfer] Failed to add ICE candidate:', err)
              }
            } else {
              if (!pendingCandidates.has(p2pUuid)) {
                pendingCandidates.set(p2pUuid, [])
              }
              pendingCandidates.get(p2pUuid).push(candidate)
            }
          }
        })

        return {
          $webrtcTransfer: {
            initiateTransfer: async (localUuid, file, recipientId, roomId) => {
              console.info(`[webrtcTransfer] Manually initiating transfer for ${localUuid}`)
            },
            handleSignal: async (signalData) => {
              console.info(`[webrtcTransfer] Manually handling signal`, signalData)
            }
          }
        }
      }
    }
  }
})
