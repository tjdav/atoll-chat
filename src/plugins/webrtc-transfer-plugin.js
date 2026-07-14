import { definePlugin } from 'coralite'

/**
 * Platform-agnostic P2P WebRTC Transfer Gateway Plugin.
 * Orchestrates direct device-to-device file transfers.
 */
export default definePlugin({
  name: 'webrtcTransfer',
  client: {
    context: async (_pluginContext) => {
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
        } catch (_err) {
          // Fall back gracefully to Web adapter
        }

        console.info('[webrtcTransfer] Web platform detected. Loading Web adapter.')
        const { createWebRTCTransferAdapter } = await import('./webrtc-transfer-adapter-web.js')
        resolvedAdapter = createWebRTCTransferAdapter()
        return resolvedAdapter
      }

      const initialAdapter = await getAdapter()

      const pendingCandidates = new Map()
      const activeTransfers = new Map()
      const incomingFilesMetadata = new Map()

      let toastEl = null
      const updateProgressToast = (title, percent) => {
        if (!toastEl) {
          toastEl = document.createElement('div')
          toastEl.style.position = 'fixed'
          toastEl.style.bottom = '20px'
          toastEl.style.right = '20px'
          toastEl.style.zIndex = '9999'
          toastEl.style.backgroundColor = '#151719'
          toastEl.style.color = '#fff'
          toastEl.style.padding = '15px 20px'
          toastEl.style.borderRadius = '8px'
          toastEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)'
          toastEl.style.minWidth = '250px'
          document.body.appendChild(toastEl)
        }
        toastEl.innerHTML = `
          <div class="d-flex align-items-center justify-content-between mb-2">
            <span class="fw-bold">${title}</span>
            <span class="text-primary fw-bold">${percent}%</span>
          </div>
          <div class="progress" style="height: 6px;">
            <div class="progress-bar progress-bar-striped progress-bar-animated bg-primary" role="progressbar" style="width: ${percent}%" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"></div>
          </div>
        `
      }

      const removeProgressToast = (successMessage = null) => {
        if (toastEl) {
          if (successMessage) {
            toastEl.innerHTML = `
              <div class="d-flex align-items-center gap-2 text-success">
                <i class="bi bi-check-circle-fill"></i>
                <span class="fw-bold">${successMessage}</span>
              </div>
            `
            setTimeout(() => {
              if (toastEl) {
                toastEl.remove()
                toastEl = null
              }
            }, 3000)
          } else {
            toastEl.remove()
            toastEl = null
          }
        }
      }

      return (instanceContext) => {
        const { globalStore, eventBus, cryptoWorker, config } = instanceContext
        const { $state } = globalStore
        const { $bus } = eventBus
        const { $worker } = cryptoWorker
        const { $config } = config

        const localIceServer = typeof process !== 'undefined' && process.env ? process.env.LOCAL_ICE_SERVER : undefined

        const finalIceServers = localIceServer
          ? [
            {
              urls: localIceServer,
              username: 'testuser',
              credential: 'testpass'
            }
          ]
          : [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]

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

        $bus.on('action:execute_p2p_transfer', async (payload) => {
          const { file, selectedUserId, roomId } = payload
          const p2pUuid = crypto.randomUUID()

          activeTransfers.set(p2pUuid, file)

          console.info(`[webrtcTransfer] Initiating ephemeral transfer ${p2pUuid} to user ${selectedUserId}`)

          updateProgressToast('Waiting for recipient...', 0)

          await sendSignalingMessage(roomId, 'p2p_transfer_request', {
            target_id: selectedUserId,
            p2pUuid,
            content: {
              filename: file.name,
              size: file.size
            },
            ephemeral: true
          })
        })

        $bus.on('action:execute_p2p_accept', async (payload) => {
          const { p2pUuid, roomId, senderId } = payload
          console.info(`[webrtcTransfer] Bob accepted ephemeral transfer ${p2pUuid} from ${senderId}`)

          updateProgressToast('Connecting...', 0)

          await sendSignalingMessage(roomId, 'p2p_accept', {
            target_id: senderId,
            p2pUuid,
            ephemeral: true
          })

          const onSignal = async (sig) => {
            await sendSignalingMessage(roomId, sig.type, {
              target_id: senderId,
              p2pUuid,
              content: sig.content,
              candidate: sig.candidate,
              ephemeral: true
            })
          }

          const onProgress = (progress) => {
            updateProgressToast('Receiving file...', progress)
          }

          const onComplete = async (blob) => {
            console.info(`[webrtcTransfer] Bob transfer completed for ${p2pUuid}`)
            removeProgressToast('Transfer complete!')

            try {
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              const meta = incomingFilesMetadata.get(p2pUuid)
              a.download = meta?.filename || 'downloaded_file'
              document.body.appendChild(a)
              a.click()
              document.body.removeChild(a)
              URL.revokeObjectURL(url)
            } catch (err) {
              console.error('[webrtcTransfer] Failed to trigger download:', err)
            }
          }

          const onError = (err) => {
            console.error(`[webrtcTransfer] Receiver error for ${p2pUuid}:`, err)
            removeProgressToast()
            alert('Transfer failed: ' + err.message)
          }

          initialAdapter.createSession(
            p2pUuid,
            false,
            onSignal,
            onProgress,
            onComplete,
            onError,
            finalIceServers
          )
        })

        $bus.on('action:execute_p2p_reject', async (payload) => {
          const { p2pUuid, roomId, senderId } = payload
          console.info(`[webrtcTransfer] Bob rejected ephemeral transfer ${p2pUuid} from ${senderId}`)

          await sendSignalingMessage(roomId, 'p2p_rejected', {
            target_id: senderId,
            p2pUuid,
            ephemeral: true
          })
        })

        $bus.on('db:new_local_data', async (payload) => {
          const { room_id: roomId, message } = payload
          if (!message) {
            return
          }

          if (message.sender_id === $state.currentUser?.id) {
            return
          }

          if (['p2p_transfer_request', 'p2p_accept', 'p2p_rejected', 'p2p_offer', 'p2p_answer', 'p2p_ice_candidate'].includes(message.type)) {
            if (message.created_at) {
              const isoStr = message.created_at.replace(' ', 'T')
              const finalStr = isoStr.endsWith('Z') ? isoStr : isoStr + 'Z'
              const msgTime = new Date(finalStr).getTime()
              if (isNaN(msgTime) || Math.abs(Date.now() - msgTime) > 300000) {
                return
              }
            }
          }

          if (message.type === 'p2p_transfer_request' && message.target_id === $state.currentUser?.id) {
            console.info(`[webrtcTransfer] Bob received p2p_transfer_request for ${message.p2pUuid}, filename: ${message.content?.filename}, size: ${message.content?.size}`)

            incomingFilesMetadata.set(message.p2pUuid, {
              filename: message.content?.filename || 'downloaded_file',
              size: message.content?.size || 0
            })

            console.info('[webrtcTransfer] Bob emitting ui:prompt_p2p_consent')
            $bus.emit('ui:prompt_p2p_consent', {
              senderId: message.sender_id,
              roomId,
              p2pUuid: message.p2pUuid,
              filename: message.content?.filename || 'downloaded_file',
              size: message.content?.size || 0
            })
          }

          if (message.type === 'p2p_rejected' && message.target_id === $state.currentUser?.id) {
            console.info(`[webrtcTransfer] Alice received p2p_rejected for ${message.p2pUuid}`)
            removeProgressToast()
            alert('Transfer was rejected by recipient.')
          }

          if (message.type === 'p2p_accept' && message.target_id === $state.currentUser?.id) {
            const p2pUuid = message.p2pUuid
            console.info(`[webrtcTransfer] Alice received p2p_accept for ${p2pUuid} from ${message.sender_id}`)

            const file = activeTransfers.get(p2pUuid)
            if (!file) {
              console.error(`[webrtcTransfer] Alice could not find cached file for ${p2pUuid}`)
              return
            }

            updateProgressToast('Connecting...', 0)

            const chunkSizeBytes = $config ? $config.get('webrtcChunkSizeBytes') : 16384

            const onSignal = async (sig) => {
              await sendSignalingMessage(roomId, sig.type, {
                target_id: message.sender_id,
                p2pUuid,
                content: sig.content,
                candidate: sig.candidate,
                ephemeral: true
              })
            }

            const onProgress = (progress) => {
              updateProgressToast('Sending file...', progress)
            }

            const onComplete = () => {
              console.info(`[webrtcTransfer] Sender transfer complete for ${p2pUuid}`)
              removeProgressToast('Transfer complete!')
              activeTransfers.delete(p2pUuid)
            }

            const onError = (err) => {
              console.error(`[webrtcTransfer] Sender transfer error for ${p2pUuid}:`, err)
              removeProgressToast()
              alert('Transfer failed: ' + err.message)
            }

            const session = initialAdapter.createSession(
              p2pUuid,
              true,
              onSignal,
              onProgress,
              onComplete,
              onError,
              finalIceServers
            )

            session.fileToSend = file
            session.chunkSizeBytes = chunkSizeBytes

            const offer = await session.pc.createOffer()
            await session.pc.setLocalDescription(offer)

            await sendSignalingMessage(roomId, 'p2p_offer', {
              target_id: message.sender_id,
              p2pUuid,
              content: offer,
              ephemeral: true
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

              const answer = await session.pc.createAnswer()
              await session.pc.setLocalDescription(answer)

              await sendSignalingMessage(roomId, 'p2p_answer', {
                target_id: message.sender_id,
                p2pUuid,
                content: answer,
                ephemeral: true
              })
            }
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
            initiateTransfer: async (_localUuid, _file, _recipientId, _roomId) => {
              console.info(`[webrtcTransfer] Manually initiating transfer for ${_localUuid}`)
            },
            handleSignal: async (_signalData) => {
              console.info(`[webrtcTransfer] Manually handling signal`, _signalData)
            }
          }
        }
      }
    }
  }
})
