import { definePlugin } from 'coralite'

/**
 * WebRTC Manager Plugin for Atoll Chat.
 * Orchestrates P2P connections using the E2EE message pipeline for signaling.
 */
export default function webrtcPlugin () {
  return definePlugin({
    name: 'webrtc-manager',
    client: {
      context: {
        $webrtc: async (globalContext) => {
          const { sendEncryptedMessage } = await import('../utils/messageUtils.js')

          // Phase 1: Global Setup
          const activeCalls = new Map()
          const { $bus, $localDb, pb, $state } = globalContext

          const rtcConfig = {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' }
            ]
          }

          /**
           * Helper to close a connection and stop all tracks.
           */
          const teardownCall = (roomId) => {
            const pc = activeCalls.get(roomId)
            if (pc) {
              pc.getSenders().forEach(sender => {
                if (sender.track) {
                  sender.track.stop()
                }
              })
              pc.close()
              activeCalls.delete(roomId)
            }
          }

          // Cleanup on unload or logout
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

          /**
           * Global listener for incoming signaling messages.
           */
          $bus.on('NEW_LOCAL_DATA', async (payload) => {
            const { room_id: roomId } = payload
            const db = $localDb

            // Fetch the latest message in this room
            const { default: Dexie } = await import('dexie')
            const message = await db.local_messages
              .where('[room_id+created_at]')
              .between([roomId, Dexie.minKey], [roomId, Dexie.maxKey])
              .last()

            if (!message) {
              return
            }

            // Standard chat messages are handled by the timeline; we only care about signaling
            if (message.type === 'call_offer') {
              $bus.emit('call_incoming', {
                roomId,
                offer: message.content
              })
            } else if (message.type === 'call_answer') {
              const pc = activeCalls.get(roomId)
              if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(message.content))
              }
            } else if (message.type === 'ice_candidate') {
              const pc = activeCalls.get(roomId)
              if (pc && message.candidate) {
                await pc.addIceCandidate(new RTCIceCandidate(message.candidate))
              }
            } else if (message.type === 'call_end') {
              teardownCall(roomId)
              $bus.emit('call_ended', { roomId })
            }
          })

          // Phase 2: Instance Context
          return async (instanceContext) => {
            /**
             * Helper to send an E2EE signaling message through the standard pipeline.
             */
            const sendSignalingMessage = async (roomId, type, payload = {}) => {
              await sendEncryptedMessage(roomId, {
                type,
                ...payload,
                timestamp: Date.now()
              }, {
                pb,
                $localDb,
                $state
              })
            }

            const setupPeerConnection = (roomId, mediaStream) => {
              const pc = new RTCPeerConnection(rtcConfig)

              if (mediaStream) {
                mediaStream.getTracks().forEach(track => pc.addTrack(track, mediaStream))
              }

              pc.onicecandidate = async (event) => {
                if (event.candidate) {
                  await sendSignalingMessage(roomId, 'ice_candidate', {
                    candidate: event.candidate
                  })
                }
              }

              pc.ontrack = (event) => {
                $bus.emit('remote_track_arrival', {
                  roomId,
                  stream: event.streams[0]
                })
              }

              pc.onicegatheringstatechange = () => {
                console.log(`[WebRTC] ICE Gathering State for ${roomId}: ${pc.iceGatheringState}`)
              }

              pc.onconnectionstatechange = () => {
                console.log(`[WebRTC] Connection State for ${roomId}: ${pc.connectionState}`)
                if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                  teardownCall(roomId)
                  $bus.emit('call_ended', { roomId })
                }
              }

              activeCalls.set(roomId, pc)
              return pc
            }

            return {
              initiateCall: async (roomId, mediaStream) => {
                const pc = setupPeerConnection(roomId, mediaStream)
                const offer = await pc.createOffer()
                await pc.setLocalDescription(offer)

                await sendSignalingMessage(roomId, 'call_offer', {
                  content: offer,
                  media_types: ['audio', 'video']
                })
              },

              answerCall: async (roomId, mediaStream, remoteOffer) => {
                const pc = setupPeerConnection(roomId, mediaStream)
                await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer))
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)

                await sendSignalingMessage(roomId, 'call_answer', {
                  content: answer
                })
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
