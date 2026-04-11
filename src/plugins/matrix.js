import { createPlugin } from 'coralite'

/**
 * @import {LoginRequest, LoginResponse, MatrixClient} from 'matrix-js-sdk'
 */

/**
 *
 * @param {Object} config
 * @param {string} [config.baseUrl='https://matrix.org']
 */
export default function ({
  baseUrl = 'https://matrix.org'
} = {}) {
  return createPlugin({
    name: 'matrix-plugin',
    client: {
      config: {
        baseUrl
      },
      imports: [{
        specifier: 'matrix-js-sdk',
        namespaceExport: 'sdk'
      }],
      setup (context) {
        let client = null
        const initClient = async (credentials, helpers) => {
          if (client) {
            return client
          }

          /** @type {import('matrix-js-sdk')}  */
          const sdk = context.imports.sdk
          const createAndInit = async (isRetry = false) => {
            const store = new sdk.IndexedDBStore({
              indexedDB: window.indexedDB,
              dbName: 'matrix-js-sdk:atoll',
              localStorage: window.localStorage
            })
            const cryptoStore = new sdk.IndexedDBCryptoStore(window.indexedDB, 'matrix-js-sdk:crypto')
            const temporaryClient = sdk.createClient({
              baseUrl: credentials.baseUrl || context.config.baseUrl,
              userId: credentials.userId,
              accessToken: credentials.accessToken,
              deviceId: credentials.deviceId,
              store: store,
              cryptoStore: cryptoStore,
              cryptoCallbacks: {
                getSecretStorageKey: async ({ keys }, name) => {
                  return new Promise((resolve) => {
                    const promptId = Date.now()
                    const abortController = new AbortController()
                    const handler = (payload) => {
                      if (payload && payload.promptId === promptId) {
                        abortController.abort()
                        resolve(payload.password)
                      }
                    }
                    helpers.subscribe('triggerPasswordPromptResolved', handler, { signal: abortController.signal })
                    helpers.setState('triggerPasswordPrompt', {
                      promptId,
                      ts: Date.now()
                    })
                  })
                }
              }

            })
            await store.startup()
            try {
              await temporaryClient.initRustCrypto()

              // Run bootstrapSecretStorage in the background so it doesn't block the initial loading
              temporaryClient.getCrypto().bootstrapSecretStorage({
                createSecretStorageKey: async () => {
                  return new Promise((resolve) => {
                    const promptId = Date.now()
                    const abortController = new AbortController()
                    const handler = (payload) => {
                      if (payload && payload.promptId === promptId) {
                        abortController.abort()
                        resolve(payload.password)
                      }
                    }
                    helpers.subscribe('triggerPasswordPromptResolved', handler, { signal: abortController.signal })
                    helpers.setState('triggerPasswordPrompt', {
                      promptId,
                      ts: Date.now()
                    })
                  })
                }
              }).catch(error => console.warn('Failed to bootstrap Secret Storage:', error))

              return temporaryClient
            } catch (error) {
              if (!isRetry && error.message && error.message.includes("doesn't match the account in the constructor")) {
                console.warn('Account mismatch detected in store, clearing indexedDB stores and retrying...')

                // Stop the client to close any open database connections
                temporaryClient.stopClient()
                if (store && store.destroy) {
                  await store.destroy()
                }
                const deleteDB = dbName => {
                  return new Promise(resolve => {
                    const request = window.indexedDB.deleteDatabase(dbName)
                    request.onsuccess = () => resolve()
                    // Ignore errors, keep trying
                    request.onerror = () => resolve()
                    request.onblocked = () => {
                      console.warn(`Deletion of IndexedDB ${dbName} is blocked.`)
                      // Resolving here can cause race conditions, but we need to proceed
                      // if the browser doesn't cleanly free the lock.
                      // Usually destroying the store releases the lock.
                      setTimeout(resolve, 500)
                    }
                  })
                }
                await deleteDB('matrix-js-sdk:atoll')
                await deleteDB('matrix-js-sdk:crypto')
                await deleteDB('matrix-js-sdk::matrix-sdk-crypto')
                await deleteDB('matrix-js-sdk::matrix-sdk-crypto-meta')
                return await createAndInit(true)
              } else {
                throw error
              }
            }
          }
          client = await createAndInit()
          if (helpers) {
            const setState = helpers.setState

            // Listen for incoming calls
            client.on('Call.incoming', call => {
              setState('triggerCallIncoming', {
                call,
                ts: Date.now()
              })
            })

            // Listen for incoming messages to trigger room list updates
            client.on('Room.timeline', (event, room, toStartOfTimeline) => {
              if (event.getType() === 'm.room.message' && !toStartOfTimeline) {
                setState('triggerRoomsUpdated', { ts: Date.now() })
              }
            })
            client.on('Room', () => {
              setState('triggerRoomsUpdated', { ts: Date.now() })
            })
            client.on('RoomState.events', () => {
              setState('triggerRoomsUpdated', { ts: Date.now() })
            })
            client.on('Event.decrypted', event => {
              setState('triggerRoomsUpdated', { ts: Date.now() })
            })
            client.on('Room.myMembership', () => {
              setState('triggerRoomsUpdated', { ts: Date.now() })
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
        getDefaultHomeserverUrl: globalContext => localContext => () => globalContext.config.baseUrl,
        registerUser: globalContext => {
          /** @type {import('matrix-js-sdk')}  */
          const sdk = globalContext.imports.sdk
          return localContext => async ({
            baseUrl,
            username,
            password,
            token
          }) => {
            try {
              const temporaryClient = sdk.createClient({
                baseUrl
              })

              // Helper function to gracefully fetch a session without throwing an exception
              const fetchNewSession = async () => {
                const response = await fetch(`${baseUrl}/_matrix/client/v3/register`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({})
                })
                if (response.status === 401) {
                  const data = await response.json()
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
              const getRequestBody = currentSession => ({
                username,
                password,
                auth: token ? {
                  type: 'm.login.registration_token',
                  token: token,
                  session: currentSession
                } : {
                  type: 'm.login.dummy',
                  session: currentSession
                }
              })
              try {
                // Attempt registration
                registerData = await temporaryClient.registerRequest(getRequestBody(session))
              } catch (error) {
                // If our cached session was rejected (401 or 403), fetch a fresh one and retry exactly once
                if (error.httpStatus === 401 || error.httpStatus === 403) {
                  console.warn('Matrix session expired or invalid. Refreshing session...')
                  session = await fetchNewSession()
                  sessionStorage.setItem('matrix_reg_session', session)

                  // Retry with the fresh session
                  registerData = await temporaryClient.registerRequest(getRequestBody(session))
                } else {
                  // Rethrow actual errors (e.g., username taken, password too weak)
                  throw error
                }
              }

              // Clean up cache on success
              sessionStorage.removeItem('matrix_reg_session')
              const credentials = {
                baseUrl: baseUrl,
                userId: registerData.user_id,
                accessToken: registerData.access_token,
                deviceId: registerData.device_id
              }
              await localContext.helpers.setPreference('atoll_session', credentials)

              // Initialize the actual client
              return await localContext.values.initClient(credentials, localContext.helpers)
            } catch (error) {
              console.error('Matrix registration failed:', error)
              throw error
            }
          }
        },
        restoreSession: globalContext => localContext => async () => {
          const credentials = await localContext.helpers.getPreference('atoll_session')
          if (!credentials) {
            return false
          }
          try {
            // Re-initialize the client with the saved credentials
            await localContext.values.initClient(credentials, localContext.helpers)

            // Start syncing in the background automatically
            const client = localContext.values.getClient()
            await client.startClient({
              initialSyncLimit: 10
            })
            return true
          } catch (event) {
            console.error('Failed to restore Matrix session:', event)
            await localContext.helpers.setPreference('atoll_session', null)
            return false
          }
        },
        login: globalContext => {
          /** @type {import('matrix-js-sdk')}  */
          const sdk = globalContext.imports.sdk
          return localContext => {
            /**
             * @param {LoginRequest} loginRequest - Request body for POST /login request
             * @returns {Promise<LoginResponse>}
             */
            return async loginRequest => {
              try {
                // Temporarily create a basic client to perform login
                const temporaryClient = sdk.createClient({
                  baseUrl: loginRequest.baseUrl || globalContext.config.baseUrl
                })

                // Remove baseUrl from the loginRequest since it's not a standard Matrix API field
                // and might cause issues with some homeservers if sent in the payload
                const requestPayload = {
                  ...loginRequest
                }
                delete requestPayload.baseUrl
                const loginData = await temporaryClient.loginRequest(requestPayload)
                const credentials = {
                  baseUrl: loginRequest.baseUrl || globalContext.config.baseUrl,
                  userId: loginData.user_id,
                  accessToken: loginData.access_token,
                  deviceId: loginData.device_id
                }
                await localContext.helpers.setPreference('atoll_session', credentials)
                return await localContext.values.initClient(credentials, localContext.helpers)
              } catch (error) {
                console.error('Matrix login failed:', error)
                throw error
              }
            }
          }
        },
        sync: globalContext => localContext => async () => {
          /** @type {MatrixClient}  */
          const client = localContext.values.getClient()
          if (!client) {
            throw new Error('Matrix client not initialized')
          }
          await client.startClient({
            initialSyncLimit: 10
          })
        },
        sendMessage: globalContext => localContext => async (roomId, messageText) => {
          /** @type {MatrixClient}  */
          const client = localContext.values.getClient()
          if (!client) {
            throw new Error('Matrix client not initialized')
          }
          const content = {
            msgtype: 'm.text',
            body: messageText
          }

          return await client.sendEvent(roomId, 'm.room.message', content, '')
        },
        createEncryptedRoom: globalContext => localContext => async (name, inviteUserId) => {
          /** @type {MatrixClient} */
          const client = localContext.values.getClient()
          if (!client) {
            throw new Error('Matrix client not initialized')
          }
          await client.waitForClientWellKnown()
          return await client.createRoom({
            visibility: 'private',
            name: name,
            invite: inviteUserId ? [inviteUserId] : [],
            initial_state: [{
              type: 'm.room.encryption',
              state_key: '',
              content: {
                algorithm: 'm.megolm.v1.aes-sha2'
              }
            }, {
              type: 'm.room.history_visibility',
              state_key: '',
              content: {
                history_visibility: 'shared'
              }
            }]
          })
        },
        inviteUser: globalContext => localContext => async (roomId, userId) => {
          /** @type {MatrixClient} */
          const client = localContext.values.getClient()
          if (!client) {
            throw new Error('Matrix client not initialized')
          }
          return await client.invite(roomId, userId)
        },
        joinRoom: globalContext => localContext => async roomId => {
          /** @type {MatrixClient} */
          const client = localContext.values.getClient()
          if (!client) {
            throw new Error('Matrix client not initialized')
          }
          return await client.joinRoom(roomId)
        },
        leaveRoom: globalContext => localContext => async roomId => {
          /** @type {MatrixClient} */
          const client = localContext.values.getClient()
          if (!client) {
            throw new Error('Matrix client not initialized')
          }
          return await client.leave(roomId)
        },
        getRooms: globalContext => localContext => async () => {
          const client = localContext.values.getClient()
          if (!client) {
            return []
          }
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
        getRoom: globalContext => localContext => async roomId => {
          const client = localContext.values.getClient()
          if (!client) {
            return null
          }
          const room = client.getRoom(roomId)
          if (!room) {
            return null
          }
          return {
            id: room.roomId,
            name: room.name,
            avatarUrl: room.getAvatarUrl(client.baseUrl, 40, 40, 'crop'),
            membership: room.getMyMembership()
          }
        },
        getCurrentUserId: globalContext => localContext => async () => {
          const client = localContext.values.getClient()
          if (!client) {
            return null
          }
          return client.getUserId()
        },
        getRoomMessages: globalContext => localContext => async roomId => {
          const client = localContext.values.getClient()
          if (!client) {
            return []
          }
          const room = client.getRoom(roomId)
          if (!room) {
            return []
          }
          const currentUserId = client.getUserId()
          return room.timeline.filter(event => event.getType() === 'm.room.message').map(event => {
            const eventId = event.getId()

            // Extract reactions from relations
            const timelineSet = room.getUnfilteredTimelineSet()
            let reactionEvents = []

            // Find the event in the timeline set and get relations
            const timeline = timelineSet.getLiveTimeline()
            const timelineEvents = timeline.getEvents()
            const targetEvent = timelineEvents.find(event => event.getId() === eventId)
            if (targetEvent) {
              // For simplicity, matrix-js-sdk might expose relations differently based on server
              // We will manually check the timeline for m.reaction events that point to this event
              reactionEvents = timelineEvents.filter(event => event.getType() === 'm.reaction' && event.getRelation()?.rel_type === 'm.annotation' && event.getRelation()?.event_id === eventId)
            }
            const reactions = {}
            reactionEvents.forEach(event => {
              const emoji = event.getRelation()?.key
              if (emoji) {
                if (!reactions[emoji]) {
                  reactions[emoji] = {
                    count: 0,
                    hasReacted: false
                  }
                }
                reactions[emoji].count++
                if (event.getSender() === currentUserId) {
                  reactions[emoji].hasReacted = true
                }
              }
            })
            return {
              id: eventId,
              txnId: event.getTxnId(),
              status: event.status,
              sender: event.getSender(),
              body: event.getContent().body,
              date: event.getDate(),
              msgtype: event.getContent().msgtype,
              info: event.getContent().info,
              reactions
            }
          })
        },
        onRoomMessage: globalContext => localContext => async (roomId, callback) => {
          const client = localContext.values.getClient()
          if (!client) {
            return () => {
            }
          }
          const handleReaction = event => {
            const relation = event.getRelation()
            if (relation && relation.rel_type === 'm.annotation') {
              const targetEventId = relation.event_id
              const emoji = relation.key
              if (targetEventId && emoji) {
                // To get the full updated state, re-calculate reactions for the target message
                const room = client.getRoom(roomId)
                if (!room) {
                  return
                }
                const timeline = room.getUnfilteredTimelineSet().getLiveTimeline()
                const timelineEvents = timeline.getEvents()
                const reactionEvents = timelineEvents.filter(event => event.getType() === 'm.reaction' && event.getRelation()?.rel_type === 'm.annotation' && event.getRelation()?.event_id === targetEventId)
                const reactions = {}
                reactionEvents.forEach(event => {
                  const key = event.getRelation()?.key
                  if (key) {
                    if (!reactions[key]) {
                      reactions[key] = {
                        count: 0,
                        hasReacted: false
                      }
                    }
                    reactions[key].count++
                    if (event.getSender() === client.getUserId()) {
                      reactions[key].hasReacted = true
                    }
                  }
                })
                localContext.helpers.setState('triggerReactionReceived', {
                  eventId: targetEventId,
                  reactions,
                  ts: Date.now()
                })
              }
            }
          }
          const handler = event => {
            if (event.getRoomId() === roomId) {
              if (event.getType() === 'm.room.message') {
                callback({
                  id: event.getId(),
                  txnId: event.getTxnId(),
                  status: event.status,
                  sender: event.getSender(),
                  body: event.getContent().body,
                  date: event.getDate(),
                  msgtype: event.getContent().msgtype,
                  info: event.getContent().info,
                  // New message won't have reactions initially
                  reactions: {}
                })
              } else if (event.getType() === 'm.reaction') {
                handleReaction(event)
              }
            }
          }
          const decryptHandler = event => {
            if (event.getRoomId() === roomId) {
              if (event.getType() === 'm.room.message') {
                callback({
                  id: event.getId(),
                  txnId: event.getTxnId(),
                  status: event.status,
                  sender: event.getSender(),
                  body: event.getContent().body,
                  date: event.getDate(),
                  msgtype: event.getContent().msgtype,
                  info: event.getContent().info,
                  // New message won't have reactions initially
                  reactions: {}
                })
              } else if (event.getType() === 'm.reaction') {
                handleReaction(event)
              }
            }
          }
          const localEchoUpdatedHandler = event => {
            if (event.getRoomId() === roomId && event.getType() === 'm.room.message') {
              callback({
                id: event.getId(),
                txnId: event.getTxnId(),
                status: event.status,
                sender: event.getSender(),
                body: event.getContent().body,
                date: event.getDate(),
                msgtype: event.getContent().msgtype,
                info: event.getContent().info,
                reactions: {}
              })
            }
          }

          // Listen for reactions getting redacted (removed)
          const redactionHandler = event => {
            if (event.getRoomId() === roomId && event.getType() === 'm.room.redaction') {
              const redactedEventId = event.event.redacts
              if (!redactedEventId) {
                return
              }
              const room = client.getRoom(roomId)
              if (!room) {
                return
              }

              // We don't easily know the parent of the redacted reaction here, so we could broadcast a general update
              // But for now, since Matrix JS SDK handles redactions by modifying the original event,
              // we can rely on `Room.timeline` or check all recent messages' reactions if needed.
              // A simple way is just re-evaluating relations for messages.
              // For simplicity, we can let the UI reload or rely on a specific redacted event handler if needed.
            }
          }
          client.on('Room.timeline', handler)
          client.on('Event.decrypted', decryptHandler)
          client.on('Room.redaction', redactionHandler)
          client.on('Room.localEchoUpdated', localEchoUpdatedHandler)
          return () => {
            client.removeListener('Room.timeline', handler)
            client.removeListener('Event.decrypted', decryptHandler)
            client.removeListener('Room.redaction', redactionHandler)
            client.removeListener('Room.localEchoUpdated', localEchoUpdatedHandler)
          }
        },
        sendReaction: globalContext => localContext => async (roomId, eventId, reactionKey) => {
          const client = localContext.values.getClient()
          if (!client) {
            throw new Error('Matrix client not initialized')
          }
          const content = {
            'm.relates_to': {
              rel_type: 'm.annotation',
              event_id: eventId,
              key: reactionKey
            }
          }
          return await client.sendEvent(roomId, 'm.reaction', content, '')
        },
        removeReaction: globalContext => localContext => async (roomId, eventId, reactionKey) => {
          const client = localContext.values.getClient()
          if (!client) {
            throw new Error('Matrix client not initialized')
          }
          const room = client.getRoom(roomId)
          if (!room) {
            throw new Error('Room not found')
          }

          // Find our existing reaction to redact it
          const timeline = room.getUnfilteredTimelineSet().getLiveTimeline()
          const timelineEvents = timeline.getEvents()
          const currentUserId = client.getUserId()
          const reactionEvent = timelineEvents.find(event => event.getType() === 'm.reaction' && event.getRelation()?.rel_type === 'm.annotation' && event.getRelation()?.event_id === eventId && event.getRelation()?.key === reactionKey && event.getSender() === currentUserId && !event.isRedacted())
          if (reactionEvent) {
            return await client.redactEvent(roomId, reactionEvent.getId())
          }
        },
        sendTorrentMessage: globalContext => localContext => async (roomId, torrentPayload) => {
          const {
            getClient
          } = localContext.values
          const client = getClient()
          if (!client) {
            throw new Error('Matrix client not initialized')
          }
          const content = {
            msgtype: 'm.atoll.webtorrent',
            body: `Sent a file: ${torrentPayload.filename}`,
            info: torrentPayload
          }
          return await client.sendEvent(roomId, 'm.room.message', content, '')
        },
        placeCall: globalContext => localContext => async (roomId, type) => {
          const client = localContext.values.getClient()
          if (!client) {
            throw new Error('Matrix client not initialized')
          }
          const call = client.createCall(roomId)
          if (type === 'video') {
            await call.placeVideoCall()
          } else {
            await call.placeVoiceCall()
          }
          return call
        },
        answerCall: globalContext => localContext => async call => {
          if (!call) {
            throw new Error('No call provided')
          }
          await call.answer()
        },
        rejectCall: globalContext => localContext => async call => {
          if (!call) {
            throw new Error('No call provided')
          }
          await call.hangup()
        }
      }
    }
  })
}
