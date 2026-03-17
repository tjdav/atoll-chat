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

          await store.startup()

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

        registerUser: (context) => {
          return async ({ baseUrl, username, password }) => {
            try {
              /** @type {import('matrix-js-sdk')}  */
              const sdk = context.imports.sdk
              const tempClient = sdk.createClient({ baseUrl })

              const registerData = await tempClient.registerRequest({
                username,
                password
              })

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

          client.on('Room.timeline', handler)

          return () => {
            client.removeListener('Room.timeline', handler)
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
