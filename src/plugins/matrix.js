import { createPlugin } from 'coralite'

/**
 * @import {LoginRequest, LoginResponse, MatrixClient} from 'matrix-js-sdk'
 */

/**
 *
 * @param {Object} config
 * @param {string} [config.baseUrl='https://matrix.org']
 */
export default function ({ baseUrl = 'https://matrix.org' } = {}) {
  return createPlugin({
    name: 'matrix-plugin',
    client: {
      config: {
        baseUrl
      },
      imports: [
        {
          specifier: 'matrix-js-sdk',
          namespaceExport: 'sdk'
        }
      ],
      setup (context) {

        let client = null

        const initClient = async (credentials, helpers) => {
          if (client) {
            return client
          }

          /** @type {import('matrix-js-sdk')}  */
          const sdk = context.imports.sdk
          const store = new sdk.IndexedDBStore({
            indexedDB: window.indexedDB,
            dbName: 'matrix-js-sdk:coralite',
            localStorage: window.localStorage
          })

          const cryptoStore = new sdk.IndexedDBCryptoStore(
            window.indexedDB,
            'matrix-js-sdk:crypto'
          )

          client = sdk.createClient({
            baseUrl: credentials.baseUrl || context.config.baseUrl,
            userId: credentials.userId,
            accessToken: credentials.accessToken,
            deviceId: credentials.deviceId,
            store: store,
            cryptoStore: cryptoStore
          })

          // Start the store with Auto-Recovery
          try {
            await store.startup()
          } catch (error) {
            if (error.message && error.message.includes("doesn't match the account")) {
              console.warn('Stale Matrix session detected. Wiping IndexedDB...')

              // Forcibly delete the mismatched databases from the browser
              window.indexedDB.deleteDatabase('matrix-js-sdk:coralite')
              window.indexedDB.deleteDatabase('matrix-js-sdk:crypto')

              // Throw a friendly error so the UI can handle it (or the user can click login again)
              throw new Error('Stale local database cleared. Please click login again to continue.')
            }
            throw error
          }

          await client.initRustCrypto()

          if (helpers) {
            const emit = helpers.emit
            const events = helpers.events

            // Listen for incoming calls
            client.on('Call.incoming', (call) => {
              emit(events('call:incoming'), { call })
            })

            // Listen for incoming messages to trigger room list updates
            client.on('Room.timeline', (event, room, toStartOfTimeline) => {
              if (event.getType() === 'm.room.message' && !toStartOfTimeline) {
                emit(events('chat:rooms-updated'))
              }
            })

            client.on('Room', () => {
              emit(events('chat:rooms-updated'))
            })

            client.on('RoomState.events', () => {
              emit(events('chat:rooms-updated'))
            })

            client.on('Event.decrypted', (event) => {
              emit(events('chat:rooms-updated'))
            })
          }

          return client
        }

        return {
          getClient: () => client,
          initClient
        }
      },
      helpers: {
        getDefaultHomeserverUrl: (context) => () => context.config.baseUrl,

        // src/plugins/matrix.js

        registerUser: (context) => {
          return async ({ baseUrl, username, password, token }) => {
            try {
              /** @type {import('matrix-js-sdk')}  */
              const sdk = context.imports.sdk
              const tempClient = sdk.createClient({ baseUrl })

              // Helper function to gracefully fetch a session without throwing an exception
              const fetchNewSession = async () => {
                const res = await fetch(`${baseUrl}/_matrix/client/v3/register`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({})
                })
                if (res.status === 401) {
                  const data = await res.json()
                  return data.session
                }
                throw new Error('Failed to initialize Matrix registration session')
              }

              //  Get session
              let session = sessionStorage.getItem('matrix_reg_session')
              if (!session) {
                session = await fetchNewSession()
                sessionStorage.setItem('matrix_reg_session', session)
              }

              let registerData
              const getRequestBody = (currentSession) => ({
                username,
                password,
                auth: token
                  ? {
                    type: 'm.login.registration_token',
                    token: token,
                    session: currentSession
                  }
                  : {
                    type: 'm.login.dummy',
                    session: currentSession
                  }
              })

              try {
                // Attempt registration
                registerData = await tempClient.registerRequest(getRequestBody(session))
              } catch (error) {
                // If our cached session was rejected (401 or 403), fetch a fresh one and retry exactly once
                if (error.httpStatus === 401 || error.httpStatus === 403) {
                  console.warn('Matrix session expired or invalid. Refreshing session...')
                  session = await fetchNewSession()
                  sessionStorage.setItem('matrix_reg_session', session)

                  // Retry with the fresh session
                  registerData = await tempClient.registerRequest(getRequestBody(session))
                } else {
                  // Rethrow actual errors (e.g., username taken, password too weak)
                  throw error
                }
              }

              // Clean up cache on success
              sessionStorage.removeItem('matrix_reg_session')

              // Initialize the actual client
              return await context.values.initClient({
                baseUrl: baseUrl,
                userId: registerData.user_id,
                accessToken: registerData.access_token,
                deviceId: registerData.device_id
              }, context.helpers)

            } catch (error) {
              console.error('Matrix registration failed:', error)
              throw error
            }
          }
        },

        login: (context) => {
          /**
           * @param {LoginRequest} loginRequest - Request body for POST /login request
           * @returns {Promise<LoginResponse>}
           */
          return async (loginRequest) => {
            try {
              /** @type {import('matrix-js-sdk')}  */
              const sdk = context.imports.sdk
              // Temporarily create a basic client to perform login
              const tempClient = sdk.createClient({ baseUrl: loginRequest.baseUrl || context.config.baseUrl })

              // Remove baseUrl from the loginRequest since it's not a standard Matrix API field
              // and might cause issues with some homeservers if sent in the payload
              const requestPayload = { ...loginRequest }
              delete requestPayload.baseUrl

              const loginData = await tempClient.loginRequest(requestPayload)

              return await context.values.initClient({
                baseUrl: loginRequest.baseUrl || context.config.baseUrl,
                userId: loginData.user_id,
                accessToken: loginData.access_token,
                deviceId: loginData.device_id
              }, context.helpers)
            } catch (error) {
              console.error('Matrix login failed:', error)
              throw error
            }
          }
        },

        sync: (context) => async () => {
          /** @type {MatrixClient}  */
          const client = context.values.getClient()

          if (!client) {
            throw new Error('Matrix client not initialized')
          }

          await client.startClient({ initialSyncLimit: 10 })
        },

        sendMessage: (context) => async (roomId, messageText) => {
          /** @type {MatrixClient}  */
          const client = context.values.getClient()

          if (!client) {
            throw new Error('Matrix client not initialized')
          }

          const content = {
            msgtype: 'm.text',
            body: messageText
          }

          return await client.sendEvent(roomId, 'm.room.message', content, '')
        },

        createEncryptedRoom: (context) => async (name, inviteUserId) => {
          /** @type {MatrixClient} */
          const client = context.values.getClient()
          if (!client) throw new Error('Matrix client not initialized')

          return await client.createRoom({
            visibility: 'private',
            name: name,
            invite: inviteUserId ? [inviteUserId] : [],
            initial_state: [
              {
                type: 'm.room.encryption',
                state_key: '',
                content: {
                  algorithm: 'm.megolm.v1.aes-sha2'
                }
              }
            ]
          })
        },

        inviteUser: (context) => async (roomId, userId) => {
          /** @type {MatrixClient} */
          const client = context.values.getClient()
          if (!client) throw new Error('Matrix client not initialized')

          return await client.invite(roomId, userId)
        },

        joinRoom: (context) => async (roomId) => {
          /** @type {MatrixClient} */
          const client = context.values.getClient()
          if (!client) throw new Error('Matrix client not initialized')

          return await client.joinRoom(roomId)
        },

        getRooms: (context) => async () => {
          const client = context.values.getClient()
          if (!client) return []
          const rooms = client.getRooms()
          return rooms.map(room => ({
            id: room.roomId,
            name: room.name,
            avatarUrl: room.getAvatarUrl(client.baseUrl, 48, 48, 'crop'),
            unreadCount: room.getUnreadNotificationCount('total'),
            lastMessage: room.timeline.length > 0 ? room.timeline[room.timeline.length - 1].getContent().body : null,
            membership: room.getMyMembership()
          }))
        },

        getRoom: (context) => async (roomId) => {
          const client = context.values.getClient()
          if (!client) return null
          const room = client.getRoom(roomId)
          if (!room) return null
          return {
            id: room.roomId,
            name: room.name,
            avatarUrl: room.getAvatarUrl(client.baseUrl, 40, 40, 'crop'),
            membership: room.getMyMembership()
          }
        },

        getCurrentUserId: (context) => async () => {
          const client = context.values.getClient()
          if (!client) return null
          return client.getUserId()
        },

        getRoomMessages: (context) => async (roomId) => {
          const client = context.values.getClient()
          if (!client) return []
          const room = client.getRoom(roomId)
          if (!room) return []

          return room.timeline
            .filter(event => event.getType() === 'm.room.message')
            .map(event => ({
              id: event.getId(),
              sender: event.getSender(),
              body: event.getContent().body,
              date: event.getDate(),
              msgtype: event.getContent().msgtype,
              info: event.getContent().info
            }))
        },

        onRoomMessage: (context) => async (roomId, callback) => {
          const client = context.values.getClient()
          if (!client) return () => {
          }

          const handler = (event) => {
            if (event.getRoomId() === roomId && event.getType() === 'm.room.message') {
              callback({
                id: event.getId(),
                sender: event.getSender(),
                body: event.getContent().body,
                date: event.getDate(),
                msgtype: event.getContent().msgtype,
                info: event.getContent().info
              })
            }
          }

          const decryptHandler = (event) => {
            if (event.getRoomId() === roomId && event.getType() === 'm.room.message') {
              callback({
                id: event.getId(),
                sender: event.getSender(),
                body: event.getContent().body,
                date: event.getDate(),
                msgtype: event.getContent().msgtype,
                info: event.getContent().info
              })
            }
          }

          client.on('Room.timeline', handler)
          client.on('Event.decrypted', decryptHandler)

          return () => {
            client.removeListener('Room.timeline', handler)
            client.removeListener('Event.decrypted', decryptHandler)
          }
        },

        sendTorrentMessage: (context) => async (roomId, torrentPayload) => {
          const { getClient } = context.values
          const client = getClient()

          if (!client) {
            throw new Error('Matrix client not initialized')
          }

          const content = {
            msgtype: 'm.coralite.webtorrent',
            body: `Sent a file: ${torrentPayload.filename}`,
            info: torrentPayload
          }

          return await client.sendEvent(roomId, 'm.room.message', content, '')
        },

        placeCall: (context) => async (roomId, type) => {
          const client = context.values.getClient()
          if (!client) throw new Error('Matrix client not initialized')

          const call = client.createCall(roomId)

          if (type === 'video') {
            await call.placeVideoCall()
          } else {
            await call.placeVoiceCall()
          }

          return call
        },

        answerCall: (context) => async (call) => {
          if (!call) throw new Error('No call provided')
          await call.answer()
        },

        rejectCall: (context) => async (call) => {
          if (!call) throw new Error('No call provided')
          await call.hangup()
        }
      }
    }
  })
}
