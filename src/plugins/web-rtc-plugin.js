import { definePlugin } from 'coralite'

/**
 * WebRTC Manager Plugin for Atoll Chat.
 * Orchestrates P2P connections using the E2EE message pipeline for signaling.
 */
export default function webrtcPlugin ({
  iceServers
} = {}) {
  const localIceServer = process.env.LOCAL_ICE_SERVER

  const defaultStun = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]

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
        // Phase 1: Global Setup
        const localIceServer = pluginContext.config.localIceServer
        const activeCalls = new Map()
        const pendingCandidates = new Map()
        const candidateBuffers = new Map()
        const candidateTimers = new Map()
        const processedMessages = new Set()
        const $bus = pluginContext.$bus

        const rtcConfig = {
          iceServers: pluginContext.config.iceServers
        }

        let globalState = null
        let globalWorker = null
        let isSignalingSetup = false

        const teardownCall = (room_id) => {
          console.log(`[WebRTC] Tearing down call for room ${room_id}`)
          if (globalState && globalState.activeCallRoomId === room_id) {
            globalState.remoteStream = null
            globalState.hasRemoteVideo = false
          }
          const pc = activeCalls.get(room_id)
          if (pc) {
            // Stop all senders
            pc.getSenders().forEach(sender => {
              if (sender.track) {
                console.log(`[WebRTC] Stopping sender track: ${sender.track.kind}`)
                sender.track.stop()
              }
            })
            // Stop all receivers
            pc.getReceivers().forEach(receiver => {
              if (receiver.track) {
                console.log(`[WebRTC] Stopping receiver track: ${receiver.track.kind}`)
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
            console.log(`[WebRTC] PeerConnection closed and removed for room ${room_id}`)
          }
          if (typeof window !== 'undefined') {
            window.__E2E_PEER_CONNECTION__ = null
          }
          pendingCandidates.delete(room_id)

          // Clear candidate batching state
          if (candidateTimers.has(room_id)) {
            clearTimeout(candidateTimers.get(room_id))
            candidateTimers.delete(room_id)
          }
          candidateBuffers.delete(room_id)
        }

        window.addEventListener('beforeunload', () => {
          for (const room_id of activeCalls.keys()) {
            teardownCall(room_id)
          }
        })

        $bus.on('auth:logout', () => {
          for (const room_id of activeCalls.keys()) {
            teardownCall(room_id)
          }
        })

        const applyPendingCandidates = async (room_id, pc) => {
          const candidates = pendingCandidates.get(room_id)
          if (!candidates || candidates.length === 0) {
            return
          }

          console.log(`[WebRTC] Replaying ${candidates.length} pending candidates for room ${room_id}`)
          while (candidates.length > 0) {
            const candidate = candidates.shift()
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate))
            } catch (err) {
              console.error(`[WebRTC] Failed to add replayed ICE candidate:`, err)
            }
          }
          pendingCandidates.delete(room_id)
        }

        const sendSignalingMessage = async (room_id, type, payload = {}) => {
          if (!globalWorker) {
            console.error('[WebRTC] Cannot send signaling message: worker not initialized')
            return
          }
          const localUuid = crypto.randomUUID()
          console.log(`[WebRTC] Sending signaling message: ${type} for room ${room_id}`)
          try {
            await globalWorker.execute('worker:send_message', {
              room_id,
              localUuid,
              type,
              ...payload,
              timestamp: Date.now()
            })
          } catch (err) {
            console.warn(`[WebRTC] Non-fatal error sending signaling message (${type}):`, err)
          }
        }

        const setupPeerConnection = async (room_id, mediaStream, $state, pb) => {
          if (activeCalls.has(room_id)) {
            console.warn(`[WebRTC] PeerConnection already exists for room ${room_id}, closing old one.`)
            teardownCall(room_id)
          }

          console.log(`[WebRTC] Setting up PeerConnection for room ${room_id}`)
          let dynamicIceServers = rtcConfig.iceServers

          if (!localIceServer) {
            const defaultStun = [
              { urls: 'stun:stun.l.google.com:19302' }
            ]
            try {
              console.log('[WebRTC] Fetching dynamic TURN credentials from PocketBase')
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
              console.warn('[WebRTC] Failed to fetch dynamic TURN credentials, falling back to STUN-only:', err)
              dynamicIceServers = defaultStun
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
            console.log(`[WebRTC] ICE Connection State changed for room ${room_id}: ${pc.iceConnectionState}`)
          }

          pc.onicecandidate = (event) => {
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
                  await sendSignalingMessage(room_id, 'ice_candidate', { candidates })
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
                sendSignalingMessage(room_id, 'ice_candidate', { candidates })
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
            console.log(`[WebRTC] Connection State changed for room ${room_id}: ${pc.connectionState}`)
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
              teardownCall(room_id)
              $bus.emit('call:ended', { room_id })
            }
          }
          activeCalls.set(room_id, pc)
          return pc
        }

        const setupSignalingListeners = ($worker, $state) => {
          if (isSignalingSetup) {
            return
          }
          isSignalingSetup = true
          globalWorker = $worker
          globalState = $state

          console.log('[WebRTC] Initializing global signaling listener')

          $bus.on('db:new_local_data', async (payload) => {
            const { room_id: room_id, message: message } = payload
            if (!message) {
              return
            }

            // Sender filtering (except for call_end which should tear down state for everyone)
            if (message.type !== 'call_end' && message.sender_id === globalState.currentUser?.id) {
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

            try {
              if (message.type === 'call_offer') {
                console.log(`[WebRTC] Received call_offer for room ${room_id}`)
                $bus.emit('call:incoming', {
                  room_id,
                  offer: message.content,
                  senderId: message.sender_id,
                  media_types: message.media_types
                })
              } else if (message.type === 'call_answer') {
                console.log(`[WebRTC] Received call_answer for room ${room_id}`)
                const pc = activeCalls.get(room_id)
                if (pc) {
                  if (pc.signalingState === 'have-local-offer') {
                    await pc.setRemoteDescription(new RTCSessionDescription(message.content))
                    console.log(`[WebRTC] Remote description set for room ${room_id}`)
                    await applyPendingCandidates(room_id, pc)
                  } else {
                    console.warn(`[WebRTC] PC in state ${pc.signalingState}, skipping setRemoteDescription`)
                  }
                }
              } else if (message.type === 'ice_candidate') {
                const pc = activeCalls.get(room_id)
                const candidates = message.candidates || (message.candidate ? [message.candidate] : [])
                console.log(`[WebRTC] Received ${candidates.length} ICE candidates for room ${room_id}`)

                for (const candidate of candidates) {
                  if (pc && pc.remoteDescription && pc.remoteDescription.type) {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate))
                  } else {
                    if (!pendingCandidates.has(room_id)) {
                      pendingCandidates.set(room_id, [])
                    }
                    pendingCandidates.get(room_id).push(candidate)
                  }
                }
              } else if (message.type === 'call_end') {
                console.log(`[WebRTC] Received call_end for room ${room_id}`)
                teardownCall(room_id)
                $bus.emit('call:ended', { room_id })
              }
            } catch (err) {
              console.error(`[WebRTC] Error handling signaling message (${message.type}):`, err)
            }
          })
        }

        return (instanceContext) => {
          const { $worker } = instanceContext.cryptoWorker
          const { $state } = instanceContext.globalStore
          const { pb } = instanceContext.pocketbase
          setupSignalingListeners($worker, $state)

          return {
            $webrtc: {
              initiateCall: async (room_id, mediaStream) => {
                const pc = await setupPeerConnection(room_id, mediaStream, $state, pb)
                const offer = await pc.createOffer()
                await pc.setLocalDescription(offer)
                const hasVideo = mediaStream.getVideoTracks().length > 0
                await sendSignalingMessage(room_id, 'call_offer', {
                  content: offer,
                  media_types: hasVideo ? ['audio', 'video'] : ['audio']
                })
              },
              answerCall: async (room_id, mediaStream, remoteOffer) => {
                const pc = await setupPeerConnection(room_id, mediaStream, $state, pb)
                await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer))
                await applyPendingCandidates(room_id, pc)
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                await sendSignalingMessage(room_id, 'call_answer', { content: answer })
              },
              endCall: async (room_id) => {
                teardownCall(room_id)
                await sendSignalingMessage(room_id, 'call_end')
              }
            }
          }
        }
      }
    }
  })
}
