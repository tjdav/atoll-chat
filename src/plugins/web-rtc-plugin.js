import { definePlugin } from 'coralite'

/**
 * WebRTC Manager Plugin for Atoll Chat.
 * Orchestrates P2P connections using the E2EE message pipeline for signaling.
 */
export default function webrtcPlugin ({
  iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
} = {}) {
  return definePlugin({
    name: 'webrtc',
    client: {
      name: 'webrtc',
      config: {
        iceServers
      },
      context: (pluginContext) => {
        // Phase 1: Global Setup
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

        const teardownCall = (roomId) => {
          if (globalState && globalState.activeCallRoomId === roomId) {
            globalState.remoteStream = null
            globalState.hasRemoteVideo = false
          }
          const pc = activeCalls.get(roomId)
          if (pc) {
            pc.getSenders().forEach(sender => {
              if (sender.track) {
                sender.track.stop()
              }
            })
            pc.getReceivers().forEach(receiver => {
              if (receiver.track) {
                receiver.track.stop()
              }
            })
            pc.close()
            activeCalls.delete(roomId)
          }
          pendingCandidates.delete(roomId)

          // Clear candidate batching state
          if (candidateTimers.has(roomId)) {
            clearTimeout(candidateTimers.get(roomId))
            candidateTimers.delete(roomId)
          }
          candidateBuffers.delete(roomId)
        }

        window.addEventListener('beforeunload', () => {
          for (const roomId of activeCalls.keys()) {
            teardownCall(roomId)
          }
        })

        $bus.on('auth:logout', () => {
          for (const roomId of activeCalls.keys()) {
            teardownCall(roomId)
          }
        })

        return (instanceContext) => {
          const { $worker } = instanceContext.cryptoWorker
          const { $state } = instanceContext.globalStore
          globalState = $state

          $bus.on('db:new_local_data', async (payload) => {
            const { room_id: roomId, message: message } = payload
            if (!message) {
              return
            }

            // Sender filtering (except for call_end which should tear down state for everyone)
            if (message.type !== 'call_end' && message.sender_id === $state.currentUser?.id) {
              return
            }

            // Stale message filtering (ignore messages older than 30 seconds)
            // Increased for robustness during local testing/CI where clocks might drift or DB lag occurs.
            if (message.created_at) {
              let dateStr = message.created_at
              // PocketBase dates might be "YYYY-MM-DD HH:mm:ss.SSSZ" or "YYYY-MM-DD HH:mm:ss.SSS"
              // Ensure T separator and Z suffix for cross-browser reliability
              const isoStr = dateStr.replace(' ', 'T')
              const finalStr = isoStr.endsWith('Z') ? isoStr : isoStr + 'Z'
              const msgTime = new Date(finalStr).getTime()

              // Increased to 5 minutes to accommodate clock drift and CI lag.
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

            if (message.type === 'call_offer') {
              $bus.emit('call:incoming', {
                roomId,
                offer: message.content,
                senderId: message.sender_id
              })
            } else if (message.type === 'call_answer') {
              const pc = activeCalls.get(roomId)
              if (pc) {
                if (pc.signalingState === 'have-local-offer') {
                  await pc.setRemoteDescription(new RTCSessionDescription(message.content))
                  await applyPendingCandidates(roomId, pc)
                } else {
                  console.warn(`[WebRTC] PC in state ${pc.signalingState}, skipping setRemoteDescription`)
                }
              }
            } else if (message.type === 'ice_candidate') {
              const pc = activeCalls.get(roomId)
              const candidates = message.candidates || (message.candidate ? [message.candidate] : [])

              for (const candidate of candidates) {
                if (pc && pc.remoteDescription) {
                  await pc.addIceCandidate(new RTCIceCandidate(candidate))
                } else {
                  if (!pendingCandidates.has(roomId)) {
                    pendingCandidates.set(roomId, [])
                  }
                  pendingCandidates.get(roomId).push(candidate)
                }
              }
            } else if (message.type === 'call_end') {
              teardownCall(roomId)
              $bus.emit('call:ended', { roomId })
            }
          }, { signal: instanceContext.signal })

          const sendSignalingMessage = async (roomId, type, payload = {}) => {
            const localUuid = crypto.randomUUID()
            await $worker.execute('worker:send_message', {
              roomId,
              localUuid,
              type,
              ...payload,
              timestamp: Date.now()
            })
          }

          const setupPeerConnection = (roomId, mediaStream) => {
            console.log(`[WebRTC] Setting up PeerConnection for room ${roomId}`)
            const pc = new RTCPeerConnection(rtcConfig)
            if (mediaStream) {
              mediaStream.getTracks().forEach(track => pc.addTrack(track, mediaStream))
            }
            pc.oniceconnectionstatechange = () => {
              console.log(`[WebRTC] ICE Connection State changed for room ${roomId}: ${pc.iceConnectionState}`)
            }
            pc.onicecandidate = (event) => {
              if (event.candidate) {
                if (!candidateBuffers.has(roomId)) {
                  candidateBuffers.set(roomId, [])
                }
                candidateBuffers.get(roomId).push(event.candidate.toJSON())

                if (candidateTimers.has(roomId)) {
                  return
                }

                const timer = setTimeout(async () => {
                  candidateTimers.delete(roomId)
                  const candidates = candidateBuffers.get(roomId)
                  if (candidates && candidates.length > 0) {
                    candidateBuffers.set(roomId, [])
                    await sendSignalingMessage(roomId, 'ice_candidate', { candidates })
                  }
                }, 500)
                candidateTimers.set(roomId, timer)
              }
            }
            pc.ontrack = (event) => {
              const stream = event.streams[0]
              if (event.track.kind === 'video') {
                $state.remoteStream = stream
                $state.hasRemoteVideo = true
              }
              $bus.emit('call:remote_track_arrival', {
                roomId,
                stream,
                track: event.track
              })
            }
            pc.onconnectionstatechange = () => {
              console.log(`[WebRTC] Connection State changed for room ${roomId}: ${pc.connectionState}`)
              if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                teardownCall(roomId)
                $bus.emit('call:ended', { roomId })
              }
            }
            activeCalls.set(roomId, pc)
            return pc
          }

          const applyPendingCandidates = async (roomId, pc) => {
            const candidates = pendingCandidates.get(roomId)
            if (!candidates || candidates.length === 0) {
              return
            }

            console.log(`[WebRTC] Replaying ${candidates.length} pending candidates for room ${roomId}`)
            while (candidates.length > 0) {
              const candidate = candidates.shift()
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate))
              } catch (err) {
                console.error(`[WebRTC] Failed to add replayed ICE candidate:`, err)
              }
            }
            pendingCandidates.delete(roomId)
          }

          return {
            $webrtc: {
              initiateCall: async (roomId, mediaStream) => {
                const pc = setupPeerConnection(roomId, mediaStream)
                const offer = await pc.createOffer()
                await pc.setLocalDescription(offer)
                const hasVideo = mediaStream.getVideoTracks().length > 0
                await sendSignalingMessage(roomId, 'call_offer', {
                  content: offer,
                  media_types: hasVideo ? ['audio', 'video'] : ['audio']
                })
              },
              answerCall: async (roomId, mediaStream, remoteOffer) => {
                const pc = setupPeerConnection(roomId, mediaStream)
                await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer))
                await applyPendingCandidates(roomId, pc)
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                await sendSignalingMessage(roomId, 'call_answer', { content: answer })
              },
              endCall: async (roomId) => {
                teardownCall(roomId)
                await sendSignalingMessage(roomId, 'call_end')
              }
            }
          }
        }
      }
    }
  })
}
