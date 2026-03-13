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
          defaultExport: '* as sdk'
        }
      ],
      setup (context) {
        let client = null

        const initClient = async (credentials) => {
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
            baseUrl: context.config.baseUrl,
            userId: credentials.userId,
            accessToken: credentials.accessToken,
            deviceId: credentials.deviceId,
            store: store,
            cryptoStore: cryptoStore
          })

          await client.initRustCrypto()
          return client
        }

        return {
          getClient: () => client,
          initClient
        }
      },
      helpers: {
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
              const tempClient = sdk.createClient({ baseUrl: context.config.baseUrl })
              const loginData = await tempClient.loginRequest(loginRequest)

              return await context.values.initClient({
                userId: loginData.user_id,
                accessToken: loginData.access_token,
                deviceId: loginData.device_id
              })
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

        createEncryptedRoom: (context) => async (inviteUserId) => {
          /** @type {MatrixClient} */
          const client = context.values.getClient()
          if (!client) throw new Error('Matrix client not initialized')

          return await client.createRoom({
            visibility: 'private',
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

        getRooms: (context) => async () => {
          const client = context.values.getClient()
          if (!client) return []
          const rooms = client.getRooms()
          return rooms.map(room => ({
            id: room.roomId,
            name: room.name,
            avatarUrl: room.getAvatarUrl(client.baseUrl, 48, 48, 'crop'),
            unreadCount: room.getUnreadNotificationCount('total'),
            lastMessage: room.timeline.length > 0 ? room.timeline[room.timeline.length - 1].getContent().body : null
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
            avatarUrl: room.getAvatarUrl(client.baseUrl, 40, 40, 'crop')
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
              date: event.getDate()
            }))
        },

        onRoomMessage: (context) => async (roomId, callback) => {
          const client = context.values.getClient()
          if (!client) return () => {}

          const handler = (event) => {
            if (event.getRoomId() === roomId && event.getType() === 'm.room.message') {
              callback({
                id: event.getId(),
                sender: event.getSender(),
                body: event.getContent().body,
                date: event.getDate()
              })
            }
          }

          client.on('Room.timeline', handler)
          
          return () => {
            client.removeListener('Room.timeline', handler)
          }
        }
      }
    }
  })
}
