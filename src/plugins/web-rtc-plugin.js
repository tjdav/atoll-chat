import { definePlugin } from 'coralite'
import { createCallStateMachine, CALL_STATES } from '../utils/call/callStateMachine.js'
import { stopRingtone, stopRingback, stopAll } from '../utils/call/callSoundManager.js'

/**
 * Defines and exports the WebRTC Manager Plugin for Atoll Chat.
 * Orchestrates P2P connections using the E2EE message pipeline for signaling.
 *
 * @param {Object} [options={}] - Configuration options for the plugin.
 * @param {Array<RTCIceServer>} [options.iceServers] - Default ICE/STUN/TURN servers.
 * @returns {import('coralite').CoralitePlugin} The registered Coralite WebRTC plugin.
 */
export default function webrtcPlugin ({
  iceServers
} = {}) {
  const localIceServer = process.env.LOCAL_ICE_SERVER

  const defaultStun = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]

  const finalIceServers = localIceServer
    ? [
      ...defaultStun,
      {
        urls: [
          localIceServer,
          `${localIceServer}?transport=udp`,
          `${localIceServer}?transport=tcp`
        ],
        username: 'testuser',
        credential: 'testpass'
      }
    ]
    : (iceServers || defaultStun)

  return definePlugin({
    name: 'webrtc',
    client: {
      name: 'webrtc',
      config: {
        iceServers: finalIceServers,
        localIceServer
      },
      context: (pluginContext) => {
        /**
         * Expands turn or turns server URLs with TCP and UDP transport protocols.
         *
         * @param {string[]} rawUrls - The list of unexpanded TURN server URL strings.
         * @returns {string[]} The list of expanded TURN server URL strings with explicit transports.
         */
        const expandTurnServerUrls = (rawUrls) => {
          if (!rawUrls || !Array.isArray(rawUrls) || rawUrls.length === 0) {
            return []
          }

          const expanded = new Set()
          rawUrls.forEach(url => {
            const cleanUrl = url.trim()
            if (!cleanUrl) {
              return
            }

            if (cleanUrl.startsWith('stun:')) {
              expanded.add(cleanUrl)
              return
            }

            if (cleanUrl.startsWith('turn:') || cleanUrl.startsWith('turns:')) {
              const baseUri = cleanUrl.replace(/^(turn:|turns:)/, '').split('?')[0]

              expanded.add(`turns:${baseUri}?transport=tcp`)
              expanded.add(`turns:${baseUri}?transport=udp`)
              expanded.add(`turn:${baseUri}?transport=udp`)
              expanded.add(`turn:${baseUri}?transport=tcp`)

              if (baseUri.includes(':5349')) {
                const fallback3478 = baseUri.replace(':5349', ':3478')
                expanded.add(`turn:${fallback3478}?transport=udp`)
                expanded.add(`turn:${fallback3478}?transport=tcp`)
              }
            }
          })

          return Array.from(expanded)
        }

        // Phase 1: Global Setup
        const localIceServer = pluginContext.config.localIceServer
        const activeCalls = new Map()
        const activeCallIdByRoom = new Map()
        const pendingCandidatesByCall = new Map()
        const candidateBuffers = new Map()
        const candidateTimers = new Map()
        const processedMessages = new Set()
        const pendingSignalingQueue = new Map()
        const inFlightAnswers = new Map()

        let outgoingTimer = null
        let incomingTimer = null

        const $bus = pluginContext.$bus

        const rtcConfig = {
          iceServers: pluginContext.config.iceServers
        }

        let globalState = null
        let globalWorker = null
        let isSignalingSetup = false

        const callFSM = createCallStateMachine({
          initialState: CALL_STATES.IDLE,
          onTransition: (newState) => {
            if (globalState) {
              globalState.set('callStatus', newState)
            }
          }
        })

        const clearCallTimers = () => {
          if (outgoingTimer) {
            clearTimeout(outgoingTimer)
            outgoingTimer = null
          }
          if (incomingTimer) {
            clearTimeout(incomingTimer)
            incomingTimer = null
          }
        }

        /**
         * Cleanly tears down any active WebRTC call for a specific room.
         * Closes peer connections, stops media tracks, and resets global call states.
         *
         * @param {string} room_id - The ID of the room to tear down.
         * @returns {void}
         */
        const teardownCall = (room_id) => {
          clearCallTimers()
          stopAll()

          const callId = activeCallIdByRoom.get(room_id)
          if (globalState && globalState.activeCallRoomId === room_id) {
            globalState.remoteStream = null
            globalState.hasRemoteVideo = false
          }
          const pc = activeCalls.get(room_id)
          if (pc) {
            // Stop all senders
            pc.getSenders().forEach(sender => {
              if (sender.track) {
                sender.track.stop()
              }
            })
            // Stop all receivers
            pc.getReceivers().forEach(receiver => {
              if (receiver.track) {
                receiver.track.stop()
              }
            })
            // Close connection
            pc.oniceconnectionstatechange = null
            pc.onicecandidate = null
            pc.ontrack = null
            pc.onconnectionstatechange = null
            pc.close()
            activeCalls.delete(room_id)
          }
          if (typeof window !== 'undefined') {
            window.__E2E_PEER_CONNECTION__ = null
          }

          if (room_id) {
            activeCallIdByRoom.delete(room_id)
          }

          if (callId) {
            pendingCandidatesByCall.delete(callId)
            inFlightAnswers.delete(callId)
          }

          // Clear candidate batching state
          if (candidateTimers.has(room_id)) {
            clearTimeout(candidateTimers.get(room_id))
            candidateTimers.delete(room_id)
          }

          candidateBuffers.delete(room_id)
          callFSM.reset()
        }

        window.addEventListener('beforeunload', () => {
          for (const room_id of activeCalls.keys()) {
            teardownCall(room_id)
          }
          pendingSignalingQueue.clear()
        })

        $bus.on('auth:logout', () => {
          for (const room_id of activeCalls.keys()) {
            teardownCall(room_id)
          }
        })

        /**
         * Replays and applies any queued/pending ICE candidates to an active RTCPeerConnection.
         *
         * @param {string} room_id - The ID of the room.
         * @param {RTCPeerConnection} pc - The active peer connection.
         * @returns {Promise<void>}
         * @throws {Error} Re-throws unexpected non-WebRTC failures.
         */
        const applyPendingCandidates = async (call_id, pc) => {
          const candidates = pendingCandidatesByCall.get(call_id)
          if (!candidates || candidates.length === 0) {
            return
          }

          while (candidates.length > 0) {
            const candidate = candidates.shift()
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate))
            } catch (err) {
              if (err instanceof Error && (
                err.name === 'InvalidStateError' ||
                err.name === 'OperationError' ||
                err.name === 'TypeError'
              )) {
                continue
              }
              throw err
            }
          }
          pendingCandidatesByCall.delete(call_id)
        }

        /**
         * Sends a WebRTC signaling message via the background message worker.
         *
         * @param {string} room_id - The ID of the room.
         * @param {string} type - The signaling message type (e.g., 'call_offer', 'call_answer', 'ice_candidate', 'call_end').
         * @param {Object} [payload={}] - Additional payload details for the message.
         * @returns {Promise<void>}
         * @throws {Error} Re-throws unexpected non-worker/non-network failures.
         */
        const sendSignalingMessage = async (room_id, type, payload = {}) => {
          if (!globalWorker) {
            return
          }
          const localUuid = crypto.randomUUID()
          try {
            await globalWorker.execute('worker:send_message', {
              room_id,
              localUuid,
              type,
              ...payload,
              timestamp: Date.now()
            })
          } catch (err) {
            if (err instanceof Error && (
              err.message.includes('worker') ||
              err.message.includes('closed') ||
              err.message.includes('network') ||
              err.message.includes('timeout')
            )) {
              return
            }
            throw err
          }
        }

        /**
         * Configures and sets up a new RTCPeerConnection for a room, including optional
         * media stream tracks and dynamic TURN credentials lookup.
         *
         * @param {string} room_id - The ID of the room.
         * @param {MediaStream} mediaStream - The local audio/video media stream.
         * @param {Object} $state - The reactive global store state.
         * @param {Object} pb - The PocketBase client context.
         * @returns {Promise<RTCPeerConnection>} Resolves to the initialized peer connection.
         * @throws {Error} Re-throws unexpected non-network failures.
         */
        const setupPeerConnection = async (room_id, mediaStream, $state, pb) => {
          if (activeCalls.has(room_id)) {
            teardownCall(room_id)
          }

          let dynamicIceServers = rtcConfig.iceServers

          if (!localIceServer) {
            const defaultStun = [
              { urls: 'stun:stun.l.google.com:19302' }
            ]
            try {
              const credentialsResponse = await pb.send('/api/turn-credentials', {
                method: 'GET'
              })

              if (credentialsResponse && credentialsResponse.username && credentialsResponse.password) {
                const rawUrls = credentialsResponse.uris || []
                const turnOnly = rawUrls.filter(u => u.startsWith('turn:') || u.startsWith('turns:'))
                const stunOnly = rawUrls.filter(u => u.startsWith('stun:'))

                dynamicIceServers = []

                if (stunOnly.length > 0) {
                  dynamicIceServers.push({ urls: stunOnly })
                } else {
                  dynamicIceServers.push(...defaultStun)
                }

                if (turnOnly.length > 0) {
                  const expandedTurnUrls = expandTurnServerUrls(turnOnly)
                  dynamicIceServers.push({
                    urls: expandedTurnUrls,
                    username: credentialsResponse.username,
                    credential: credentialsResponse.password
                  })
                }
              } else {
                dynamicIceServers = defaultStun
              }
            } catch (err) {
              if (err instanceof Error && (
                err.name === 'ClientResponseError' ||
                err.message.includes('network') ||
                err.message.includes('Failed to fetch') ||
                err.message.includes('Fetch') ||
                err.status === 401 ||
                err.status === 404 ||
                err.status === 500
              )) {
                dynamicIceServers = defaultStun
              } else {
                throw err
              }
            }
          }

          const pc = new RTCPeerConnection({
            iceServers: dynamicIceServers,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
          })

          if (typeof window !== 'undefined') {
            window.__E2E_PEER_CONNECTION__ = pc
          }

          if (mediaStream) {
            mediaStream.getTracks().forEach(track => pc.addTrack(track, mediaStream))
          }
          pc.oniceconnectionstatechange = () => {
            // ICE Connection State changed handler
          }

          pc.onicecandidate = (event) => {
            const call_id = activeCallIdByRoom.get(room_id)
            if (event.candidate) {
              if (!candidateBuffers.has(room_id)) {
                candidateBuffers.set(room_id, [])
              }
              candidateBuffers.get(room_id).push(event.candidate.toJSON())

              if (candidateTimers.has(room_id)) {
                return
              }

              const timer = setTimeout(async () => {
                candidateTimers.delete(room_id)
                const candidates = candidateBuffers.get(room_id)
                if (candidates && candidates.length > 0) {
                  candidateBuffers.set(room_id, [])
                  await sendSignalingMessage(room_id, 'ice_candidate', {
                    call_id,
                    candidates
                  })
                }
              }, 500)
              candidateTimers.set(room_id, timer)
            } else {
              // End of candidates: flush remaining immediately
              if (candidateTimers.has(room_id)) {
                clearTimeout(candidateTimers.get(room_id))
                candidateTimers.delete(room_id)
              }
              const candidates = candidateBuffers.get(room_id)
              if (candidates && candidates.length > 0) {
                candidateBuffers.set(room_id, [])
                sendSignalingMessage(room_id, 'ice_candidate', {
                  call_id,
                  candidates
                })
              }
            }
          }

          pc.ontrack = (event) => {
            const stream = event.streams[0]
            if (stream) {
              $state.remoteStream = stream
            }

            if (event.track.kind === 'video') {
              $state.hasRemoteVideo = true
            }

            $bus.emit('call:remote_track_arrival', {
              room_id,
              stream,
              track: event.track
            })
          }
          pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
              const call_id = activeCallIdByRoom.get(room_id)
              teardownCall(room_id)
              $bus.emit('call:ended', {
                room_id,
                call_id,
                reason: 'connection_closed'
              })
            }
          }
          activeCalls.set(room_id, pc)
          return pc
        }

        /**
         * Processes an individual WebRTC call signaling message.
         *
         * @param {string} room_id - The ID of the room.
         * @param {Object} message - The signaling message object.
         * @returns {Promise<void>}
         * @throws {Error} Re-throws unexpected non-WebRTC failures.
         */
        const processSignalingMessage = async (room_id, message) => {
          try {
            if (!message || !message.call_id) {
              console.warn('[webrtc] Signaling message missing call_id; discarding:', message)
              return
            }

            const currentCallId = activeCallIdByRoom.get(room_id)

            if (message.type === 'call_offer') {
              // Also check globalState.callStatus for legacy 'active' or external state sync
              const isGlobalIdle = globalState ? (globalState.callStatus === 'idle' || !globalState.callStatus) : true
              if (callFSM.is(CALL_STATES.IDLE) && isGlobalIdle) {
                callFSM.transition(CALL_STATES.INCOMING)
                activeCallIdByRoom.set(room_id, message.call_id)
                globalState.activeCallId = message.call_id

                // Arm 45-second incoming timer
                clearCallTimers()
                incomingTimer = setTimeout(async () => {
                  incomingTimer = null
                  const call_id = activeCallIdByRoom.get(room_id) || message.call_id
                  await sendSignalingMessage(room_id, 'call_end', {
                    call_id,
                    reason: 'missed'
                  })
                  stopRingtone()
                  teardownCall(room_id)
                  $bus.emit('call:ended', {
                    room_id,
                    call_id,
                    reason: 'missed'
                  })
                }, 45000)

                $bus.emit('call:incoming', {
                  room_id,
                  call_id: message.call_id,
                  caller_id: message.caller_id || message.sender_id,
                  target_id: message.target_id,
                  offer: message.content,
                  senderId: message.sender_id,
                  media_types: message.media_types
                })
              } else {
                if (message.call_id !== currentCallId) {
                  await sendSignalingMessage(room_id, 'call_end', {
                    call_id: message.call_id,
                    reason: 'busy'
                  })
                }
              }
            } else if (message.type === 'call_answer') {
              if (message.sender_id === globalState.currentUser?.id && callFSM.is(CALL_STATES.INCOMING) && globalState.activeCallRoomId === room_id) {
                if (message.call_id === currentCallId) {
                  teardownCall(room_id)
                  $bus.emit('call:ended', {
                    room_id,
                    call_id: message.call_id,
                    reason: 'answered_elsewhere'
                  })
                  $bus.emit('ui:show_toast', {
                    message: 'Call answered on another device',
                    variant: 'primary'
                  })
                  callFSM.reset()
                  globalState.activeCallRoomId = null
                  globalState.activeCallId = null
                  globalState.remoteStream = null
                  globalState.hasRemoteVideo = false
                  globalState.localStream = null
                }
                return
              }

              if (message.call_id !== currentCallId) {
                console.warn(`[webrtc] Discarding call_answer for mismatched call_id "${message.call_id}" (active: "${currentCallId}")`)
                return
              }

              const pc = activeCalls.get(room_id)
              if (pc) {
                if (pc.signalingState === 'have-local-offer') {
                  await pc.setRemoteDescription(new RTCSessionDescription(message.content))
                  await applyPendingCandidates(currentCallId, pc)

                  // Immediately halt ringback and transition state to CONNECTED upon setRemoteDescription
                  clearCallTimers()
                  stopRingback()

                  if (callFSM.canTransitionTo(CALL_STATES.CONNECTED)) {
                    callFSM.transition(CALL_STATES.CONNECTED)
                  }
                }
              }
            } else if (message.type === 'ice_candidate') {
              if (message.call_id !== currentCallId) {
                console.warn(`[webrtc] Discarding ice_candidate for mismatched call_id "${message.call_id}" (active: "${currentCallId}")`)
                return
              }

              const pc = activeCalls.get(room_id)
              const candidates = message.candidates || (message.candidate ? [message.candidate] : [])

              for (const candidate of candidates) {
                if (pc && pc.remoteDescription && pc.remoteDescription.type) {
                  await pc.addIceCandidate(new RTCIceCandidate(candidate))
                } else {
                  if (!pendingCandidatesByCall.has(currentCallId)) {
                    pendingCandidatesByCall.set(currentCallId, [])
                  }
                  pendingCandidatesByCall.get(currentCallId).push(candidate)
                }
              }
            } else if (message.type === 'call_end') {
              if (currentCallId && message.call_id !== currentCallId) {
                console.warn(`[webrtc] Discarding call_end for mismatched call_id "${message.call_id}" (active: "${currentCallId}")`)
                return
              }

              if (message.reason === 'busy') {
                $bus.emit('ui:show_toast', {
                  message: 'User is busy on another call',
                  variant: 'warning'
                })
              } else if (message.reason === 'missed' || message.reason === 'timeout') {
                $bus.emit('ui:show_toast', {
                  message: 'User did not answer',
                  variant: 'warning'
                })
              }

              teardownCall(room_id)
              $bus.emit('call:ended', {
                room_id,
                call_id: message.call_id,
                reason: message.reason || 'remote_ended'
              })
            }
          } catch (err) {
            if (err instanceof Error && (
              err.name === 'InvalidStateError' ||
              err.name === 'OperationError' ||
              err.name === 'TypeError' ||
              err.message.includes('RTCPeerConnection')
            )) {
              return
            }
            throw err
          }
        }

        /**
         * Reconciles queued call signaling messages once historical catch-up finishes.
         *
         * @returns {Promise<void>}
         * @throws {Error} Re-throws unexpected non-WebRTC failures.
         */
        const reconcileSignalingQueue = async () => {
          for (const [room_id, queue] of pendingSignalingQueue.entries()) {
            // Group queued signaling messages by call_id, discarding any lacking call_id
            const groupsByCallId = new Map()
            for (const msg of queue) {
              if (!msg || !msg.call_id) {
                continue
              }
              if (!groupsByCallId.has(msg.call_id)) {
                groupsByCallId.set(msg.call_id, [])
              }
              groupsByCallId.get(msg.call_id).push(msg)
            }

            for (const [callId, callMsgs] of groupsByCallId.entries()) {
              // Check if there is a call_end in the session group
              const hasCallEnd = callMsgs.some(msg => msg.type === 'call_end')
              if (hasCallEnd) {
                // Call session was cancelled or ended, discard this session group
                continue
              }

              // Find the call_offer message
              const callOffer = callMsgs.find(msg => msg.type === 'call_offer')
              if (callOffer) {
                const callTime = callOffer.timestamp || (callOffer.created_at ? new Date(callOffer.created_at.replace(' ', 'T') + 'Z').getTime() : 0)
                const isRecent = callTime && (Date.now() - callTime < 45000)

                if (isRecent) {
                  await processSignalingMessage(room_id, callOffer)

                  for (const msg of callMsgs) {
                    if (msg !== callOffer) {
                      await processSignalingMessage(room_id, msg)
                    }
                  }
                }
              }
            }
          }
          pendingSignalingQueue.clear()
        }

        /**
         * Initializes database-event listeners for WebRTC signaling messages.
         * Subscribes to and handles incoming offers, answers, candidates, and call closures.
         *
         * @param {Object} $worker - The background crypto/message worker execution context.
         * @param {Object} $state - The reactive global store state.
         * @returns {void}
         */
        const setupSignalingListeners = ($worker, $state) => {
          if (isSignalingSetup) {
            return
          }
          isSignalingSetup = true
          globalWorker = $worker
          globalState = $state

          // Synchronize callFSM with globalState callStatus if modified externally or on boot
          if (globalState.callStatus) {
            const normalizedStatus = globalState.callStatus === 'active' ? CALL_STATES.CONNECTED : globalState.callStatus
            if (Object.values(CALL_STATES).includes(normalizedStatus) && normalizedStatus !== callFSM.getState()) {
              callFSM.reset()
              if (normalizedStatus !== CALL_STATES.IDLE && callFSM.canTransitionTo(normalizedStatus)) {
                callFSM.transition(normalizedStatus)
              }
            }
          }

          // Listen for sync:complete to reconcile any queued signaling messages
          $bus.on('sync:complete', async () => {
            await reconcileSignalingQueue()
          })

          $bus.on('db:new_local_data', async (payload) => {
            const { room_id, message } = payload
            if (!message) {
              return
            }

            // Sender filtering (except for call_end and call_answer which should tear down/de-escalate state for everyone)
            if (!['call_end', 'call_answer'].includes(message.type) && message.sender_id === globalState.currentUser?.id) {
              return
            }

            // Stale message filtering (ignore messages older than 5 minutes)
            if (message.created_at) {
              const isoStr = message.created_at.replace(' ', 'T')
              const finalStr = isoStr.endsWith('Z') ? isoStr : isoStr + 'Z'
              const msgTime = new Date(finalStr).getTime()
              if (isNaN(msgTime) || Math.abs(Date.now() - msgTime) > 300000) {
                return
              }
            }

            if (message.id && processedMessages.has(message.id)) {
              return
            }
            if (message.id) {
              processedMessages.add(message.id)
            }

            // Queue WebRTC signaling messages during historical catch-up sync phase
            if (globalState.isCatchingUp) {
              if (['call_offer', 'call_end', 'call_answer', 'ice_candidate'].includes(message.type)) {
                if (!pendingSignalingQueue.has(room_id)) {
                  pendingSignalingQueue.set(room_id, [])
                }
                pendingSignalingQueue.get(room_id).push(message)
                return
              }
            }

            // Otherwise, process signaling message immediately in real-time
            await processSignalingMessage(room_id, message)
          })
        }

        return (instanceContext) => {
          const { $worker } = instanceContext.cryptoWorker
          const { $state } = instanceContext.globalStore
          const { pb } = instanceContext.pocketbase
          setupSignalingListeners($worker, $state)

          return {
            $webrtc: {
              /**
               * Returns the current state machine instance.
               */
              getFSM: () => callFSM,

              /**
               * Initiates an outgoing WebRTC call.
               *
               * @param {string} room_id - The ID of the room to call.
               * @param {MediaStream} mediaStream - The local media stream tracks to send.
               * @returns {Promise<void>}
               */
              initiateCall: async (room_id, mediaStream) => {
                if (!callFSM.canTransitionTo(CALL_STATES.OUTGOING)) {
                  console.warn(`[webrtc] Cannot initiate call from state "${callFSM.getState()}"`)
                  return
                }

                callFSM.transition(CALL_STATES.OUTGOING)
                const call_id = crypto.randomUUID()
                activeCallIdByRoom.set(room_id, call_id)
                $state.activeCallId = call_id
                $state.activeCallRoomId = room_id

                // Arm 45-second outgoing timer
                clearCallTimers()
                outgoingTimer = setTimeout(async () => {
                  outgoingTimer = null
                  const activeCallId = activeCallIdByRoom.get(room_id) || call_id
                  await sendSignalingMessage(room_id, 'call_end', {
                    call_id: activeCallId,
                    reason: 'timeout'
                  })
                  stopRingback()
                  teardownCall(room_id)
                  $bus.emit('ui:show_toast', {
                    message: 'User did not answer',
                    variant: 'warning'
                  })
                  $bus.emit('call:ended', {
                    room_id,
                    call_id: activeCallId,
                    reason: 'timeout'
                  })
                }, 45000)

                const pc = await setupPeerConnection(room_id, mediaStream, $state, pb)
                const offer = await pc.createOffer()
                await pc.setLocalDescription(offer)
                const hasVideo = mediaStream.getVideoTracks().length > 0
                await sendSignalingMessage(room_id, 'call_offer', {
                  call_id,
                  caller_id: $state.currentUser?.id,
                  target_id: null,
                  content: offer,
                  media_types: hasVideo ? ['audio', 'video'] : ['audio']
                })
              },

              /**
               * Answers an incoming WebRTC call with in-flight deduplication.
               *
               * @param {string} room_id - The ID of the room.
               * @param {MediaStream} mediaStream - The local media stream tracks to send.
               * @param {RTCSessionDescriptionInit} remoteOffer - The remote caller's SDP offer.
               * @param {string} [call_id] - The session ID of the call being answered.
               * @returns {Promise<void>}
               */
              answerCall: (room_id, mediaStream, remoteOffer, call_id) => {
                const currentCallId = call_id || activeCallIdByRoom.get(room_id) || $state.activeCallId

                // Resolve immediately if already connected or not incoming
                if (callFSM.is(CALL_STATES.CONNECTED) || (!callFSM.is(CALL_STATES.INCOMING) && !callFSM.canTransitionTo(CALL_STATES.CONNECTED))) {
                  return Promise.resolve()
                }

                // In-flight promise deduplication guard
                if (currentCallId && inFlightAnswers.has(currentCallId)) {
                  return inFlightAnswers.get(currentCallId)
                }

                const executeAnswer = async () => {
                  try {
                    clearCallTimers()
                    stopRingtone()

                    if (currentCallId) {
                      activeCallIdByRoom.set(room_id, currentCallId)
                      $state.activeCallId = currentCallId
                    }
                    $state.activeCallRoomId = room_id

                    const pc = await setupPeerConnection(room_id, mediaStream, $state, pb)
                    await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer))
                    if (currentCallId) {
                      await applyPendingCandidates(currentCallId, pc)
                    }
                    const answer = await pc.createAnswer()
                    await pc.setLocalDescription(answer)
                    await sendSignalingMessage(room_id, 'call_answer', {
                      call_id: currentCallId,
                      content: answer
                    })

                    if (callFSM.canTransitionTo(CALL_STATES.CONNECTED)) {
                      callFSM.transition(CALL_STATES.CONNECTED)
                    }
                  } finally {
                    if (currentCallId) {
                      inFlightAnswers.delete(currentCallId)
                    }
                  }
                }

                const answerPromise = executeAnswer()
                if (currentCallId) {
                  inFlightAnswers.set(currentCallId, answerPromise)
                }

                return answerPromise
              },

              /**
               * Terminate/end an active call.
               *
               * @param {string} room_id - The ID of the room.
               * @param {string} [call_id] - The session ID of the call being ended.
               * @returns {Promise<void>}
               */
              endCall: async (room_id, call_id) => {
                const currentCallId = call_id || activeCallIdByRoom.get(room_id) || $state.activeCallId
                teardownCall(room_id)
                await sendSignalingMessage(room_id, 'call_end', { call_id: currentCallId })
              }
            }
          }
        }
      }
    }
  })
}
