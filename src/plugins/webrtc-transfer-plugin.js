import { definePlugin } from 'coralite'

/**
 * Platform-agnostic P2P WebRTC Transfer Gateway Plugin.
 * Orchestrates direct device-to-device file transfers.
 */
export default definePlugin({
  name: 'webrtcTransfer',
  client: {
    context: () => {
      let resolvedAdapter = null

      /**
       * Dynamically resolves and loads the platform-specific WebRTC transfer adapter.
       *
       * @returns {Promise<object>} A promise resolving to the resolved adapter instance.
       * @throws {Error} If both dynamic native adapter and web adapter fallback fail.
       */
      const getAdapter = async () => {
        if (resolvedAdapter) {
          return resolvedAdapter
        }

        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            const { createNativeRTCTransferAdapter } = await import('./webrtc-transfer-adapter-native.js')
            resolvedAdapter = createNativeRTCTransferAdapter()
            return resolvedAdapter
          }
        } catch (err) {
          // Real recovery: Fallback gracefully to Web adapter if Capacitor is not present in web viewport
          if (err instanceof Error && (err.name === 'TypeError' || err.message.includes('Failed to resolve') || err.message.includes('module') || err.message.includes('import'))) {
            const { createWebRTCTransferAdapter } = await import('./webrtc-transfer-adapter-web.js')
            resolvedAdapter = createWebRTCTransferAdapter()
            return resolvedAdapter
          }
          throw err
        }

        const { createWebRTCTransferAdapter } = await import('./webrtc-transfer-adapter-web.js')
        resolvedAdapter = createWebRTCTransferAdapter()
        return resolvedAdapter
      }

      const adapterPromise = getAdapter()

      const pendingCandidates = new Map()
      const activeTransfers = new Map()
      const incomingFilesMetadata = new Map()
      const processedTransferUuids = new Set()

      let toastEl = null

      /**
       * Creates or updates a floating progress toast/banner in the DOM.
       *
       * @param {string} title - The title or descriptive text to show.
       * @param {number} percent - The current transfer completion percentage (0-100).
       * @returns {void}
       */
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

        toastEl.innerHTML = ''

        const header = document.createElement('div')
        header.className = 'd-flex align-items-center justify-content-between mb-2'

        const titleSpan = document.createElement('span')
        titleSpan.className = 'fw-bold'
        titleSpan.textContent = title

        const percentSpan = document.createElement('span')
        percentSpan.className = 'text-primary fw-bold'
        percentSpan.textContent = `${percent}%`

        header.appendChild(titleSpan)
        header.appendChild(percentSpan)

        const progressWrapper = document.createElement('div')
        progressWrapper.className = 'progress'
        progressWrapper.style.height = '6px'

        const progressBar = document.createElement('div')
        progressBar.className = 'progress-bar progress-bar-striped progress-bar-animated bg-primary'
        progressBar.setAttribute('role', 'progressbar')
        progressBar.style.width = `${percent}%`
        progressBar.setAttribute('aria-valuenow', percent)
        progressBar.setAttribute('aria-valuemin', '0')
        progressBar.setAttribute('aria-valuemax', '100')

        progressWrapper.appendChild(progressBar)

        toastEl.appendChild(header)
        toastEl.appendChild(progressWrapper)
      }

      /**
       * Dismisses and removes the progress toast/banner from the DOM.
       *
       * @param {string|null} [successMessage=null] - Optional success message to show briefly before dismissal.
       * @returns {void}
       */
      const removeProgressToast = (successMessage = null) => {
        if (toastEl) {
          if (successMessage) {
            toastEl.innerHTML = ''

            const wrapper = document.createElement('div')
            wrapper.className = 'd-flex align-items-center gap-2 text-success'

            const icon = document.createElement('atoll-icon')
            icon.setAttribute('name', 'check-circle')
            icon.setAttribute('size', '18')
            icon.setAttribute('color', 'var(--bs-success)')

            const span = document.createElement('span')
            span.className = 'fw-bold'
            span.textContent = successMessage

            wrapper.appendChild(icon)
            wrapper.appendChild(span)
            toastEl.appendChild(wrapper)

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
        const { globalStore, eventBus, cryptoWorker, config, pocketbase } = instanceContext
        const { $state } = globalStore
        const { $bus } = eventBus
        const { $worker } = cryptoWorker
        const { $config } = config
        const localIceServer = $config ? $config.get('localIceServer') : undefined

        /**
         * Resolves the list of ICE/STUN/TURN servers to use for WebRTC connection.
         * Attempts to fetch dynamic TURN credentials from PocketBase if localIceServer is not set.
         *
         * @returns {Promise<Array<object>>} Resolves to an array of RTCIceServer configuration objects.
         */
        const getIceServers = async () => {
          if (localIceServer) {
            return [
              {
                urls: localIceServer,
                username: 'testuser',
                credential: 'testpass'
              }
            ]
          }

          const defaultStun = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]

          try {
            const { pb } = pocketbase
            const credentialsResponse = await pb.send('/api/turn-credentials', {
              method: 'GET'
            })

            if (credentialsResponse && credentialsResponse.username && credentialsResponse.password) {
              const rawUrls = credentialsResponse.uris || []
              const turnOnly = rawUrls.filter(u => u.startsWith('turn:') || u.startsWith('turns:'))
              const stunOnly = rawUrls.filter(u => u.startsWith('stun:'))

              const resultServers = [
                ...defaultStun,
                ...stunOnly.map(u => ({ urls: u }))
              ]

              if (turnOnly.length > 0) {
                resultServers.push({
                  urls: turnOnly,
                  username: credentialsResponse.username,
                  credential: credentialsResponse.password
                })
              }
              return resultServers
            }
          } catch (err) {
            // Expected network or session auth exception. Fall back safely to default public STUN.
            if (err instanceof Error && (err.name === 'ClientResponseError' || err.message.includes('network') || err.message.includes('fetch'))) {
              // Real recovery: Fallback gracefully to public STUN
            } else {
              throw err
            }
          }

          return defaultStun
        }

        /**
         * Sends an ephemeral P2P signaling message via the central crypto worker.
         *
         * @param {string} roomId - The ID of the active chat room.
         * @param {string} type - The signaling message type (e.g. offer, answer, ice candidate).
         * @param {object} [payload={}] - Additional metadata or signaling payloads.
         * @returns {Promise<void>}
         */
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

        $bus.on('auth:logout', () => {
          processedTransferUuids.clear()
        })

        $bus.on('action:execute_p2p_transfer', async (payload) => {
          const { file, selectedUserId, roomId } = payload
          const p2pUuid = crypto.randomUUID()

          processedTransferUuids.add(p2pUuid)
          activeTransfers.set(p2pUuid, file)

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
            removeProgressToast('Transfer complete!')

            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            const meta = incomingFilesMetadata.get(p2pUuid)
            a.download = meta?.filename || 'downloaded_file'
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
          }

          const onError = (err) => {
            removeProgressToast()
            alert('Transfer failed: ' + err.message)
          }

          const activeIceServers = await getIceServers()
          const adapter = await adapterPromise
          adapter.createSession(
            p2pUuid,
            false,
            onSignal,
            onProgress,
            onComplete,
            onError,
            activeIceServers
          )
        })

        $bus.on('action:execute_p2p_reject', async (payload) => {
          const { p2pUuid, roomId, senderId } = payload

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
            if (processedTransferUuids.has(message.p2pUuid)) {
              return
            }
            processedTransferUuids.add(message.p2pUuid)

            incomingFilesMetadata.set(message.p2pUuid, {
              filename: message.content?.filename || 'downloaded_file',
              size: message.content?.size || 0
            })

            $bus.emit('ui:prompt_p2p_consent', {
              senderId: message.sender_id,
              roomId,
              p2pUuid: message.p2pUuid,
              filename: message.content?.filename || 'downloaded_file',
              size: message.content?.size || 0
            })
          }

          if (message.type === 'p2p_rejected' && message.target_id === $state.currentUser?.id) {
            removeProgressToast()
            alert('Transfer was rejected by recipient.')
          }

          if (message.type === 'p2p_accept' && message.target_id === $state.currentUser?.id) {
            const p2pUuid = message.p2pUuid

            const file = activeTransfers.get(p2pUuid)
            if (!file) {
              return
            }

            const adapter = await adapterPromise
            if (adapter.sessions.has(p2pUuid)) {
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
              removeProgressToast('Transfer complete!')
              activeTransfers.delete(p2pUuid)
            }

            const onError = (err) => {
              removeProgressToast()
              alert('Transfer failed: ' + err.message)
            }

            const activeIceServers = await getIceServers()
            const session = adapter.createSession(
              p2pUuid,
              true,
              onSignal,
              onProgress,
              onComplete,
              onError,
              activeIceServers
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
              await adapter.startOutgoing(p2pUuid, session.fileToSend, session.chunkSizeBytes)
            }
          }

          if (message.type === 'p2p_offer' && message.target_id === $state.currentUser?.id) {
            const p2pUuid = message.p2pUuid

            const adapter = await adapterPromise
            const session = adapter.sessions.get(p2pUuid)

            if (session) {
              await session.pc.setRemoteDescription(new RTCSessionDescription(message.content))

              const pending = pendingCandidates.get(p2pUuid) || []
              while (pending.length > 0) {
                const candidate = pending.shift()
                try {
                  await session.pc.addIceCandidate(new RTCIceCandidate(candidate))
                } catch (err) {
                  // Fall back gracefully if the ICE candidate is invalid or expired
                  if (err instanceof Error && (err.name === 'InvalidStateError' || err.name === 'OperationError' || err.message.includes('candidate'))) {
                    // expected WebRTC ICE candidate rejection
                  } else {
                    throw err
                  }
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
            const adapter = await adapterPromise
            const session = adapter.sessions.get(p2pUuid)

            if (session) {
              await session.pc.setRemoteDescription(new RTCSessionDescription(message.content))

              const pending = pendingCandidates.get(p2pUuid) || []
              while (pending.length > 0) {
                const candidate = pending.shift()
                try {
                  await session.pc.addIceCandidate(new RTCIceCandidate(candidate))
                } catch (err) {
                  // Fall back gracefully if the ICE candidate is invalid or expired
                  if (err instanceof Error && (err.name === 'InvalidStateError' || err.name === 'OperationError' || err.message.includes('candidate'))) {
                    // expected WebRTC ICE candidate rejection
                  } else {
                    throw err
                  }
                }
              }
              pendingCandidates.delete(p2pUuid)
            }
          }

          if (message.type === 'p2p_ice_candidate' && message.target_id === $state.currentUser?.id) {
            const p2pUuid = message.p2pUuid
            const candidate = message.candidate
            const adapter = await adapterPromise
            const session = adapter.sessions.get(p2pUuid)
            if (session && session.pc.remoteDescription && session.pc.remoteDescription.type) {
              try {
                await session.pc.addIceCandidate(new RTCIceCandidate(candidate))
              } catch (err) {
                if (err instanceof Error && (err.name === 'InvalidStateError' || err.name === 'OperationError' || err.message.includes('candidate'))) {
                  // expected WebRTC ICE candidate rejection
                } else {
                  throw err
                }
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
            /**
             * Manually initiates a WebRTC P2P transfer session.
             *
             * @param {string} localUuid - The local session UUID.
             * @param {File} file - The file object to transfer.
             * @param {string} recipientId - The user ID of the recipient.
             * @param {string} roomId - The active chat room ID.
             * @returns {Promise<void>}
             */
            initiateTransfer: async (localUuid, file, recipientId, roomId) => {
              // Manual initiation endpoint override stub
            },
            /**
             * Manually handles incoming WebRTC signaling data.
             *
             * @param {object} signalData - The signaling content and metadata.
             * @returns {Promise<void>}
             */
            handleSignal: async (signalData) => {
              // Manual signaling handler stub
            }
          }
        }
      }
    }
  }
})
