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
              localStorage: window.localStorage,
              dbName: 'matrix-js-sdk:atoll'
            })

            const temporaryClient = sdk.createClient({
              baseUrl: credentials.baseUrl || context.config.baseUrl,
              userId: credentials.userId,
              accessToken: credentials.accessToken,
              deviceId: credentials.deviceId,
              store: store,
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
              // ... rest of your background bootstrapping logic stays exactly the same
              // Run crypto bootstrapping in the background so it doesn't block the initial loading
              ;(async () => {
                try {
                  await temporaryClient.getCrypto().bootstrapSecretStorage({
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
                  })

                  await temporaryClient.getCrypto().bootstrapCrossSigning({
                    authUploadDeviceSigningKeys: async (makeRequest) => {
                      const password = await new Promise((resolve) => {
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

                      return makeRequest({
                        type: 'm.login.password',
                        identifier: {
                          type: 'm.id.user',
                          user: credentials.userId || temporaryClient.getUserId()
                        },
                        password: password
                      })
                    }
                  })

                  const hasKeyBackup = (await temporaryClient.getCrypto().checkKeyBackupAndEnable()) !== null
                  if (!hasKeyBackup) {
                    await temporaryClient.getCrypto().resetKeyBackup()
                  }
                } catch (error) {
                  console.warn('Failed to bootstrap crypto:', error)
                }
              })()

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
        createRoom: globalContext => localContext => async (options) => {
          /** @type {import('matrix-js-sdk')} */
          const sdk = globalContext.imports.sdk
          const client = localContext.values.getClient()

          if (!client) {
            throw new Error('Matrix client not initialized')
          }
          await client.waitForClientWellKnown()

          const roomOptions = {
            name: options.name,
            preset: options.preset || sdk.Preset.PrivateChat,
            is_direct: !!options.is_direct
          }

          if (options.visibility) {
            roomOptions.visibility = options.visibility
          }

          if (options.topic) {
            roomOptions.topic = options.topic
          }

          if (options.room_alias_name) {
            roomOptions.room_alias_name = options.room_alias_name
          }

          const initialState = []

          if (options.enableEncryption !== false) {
            initialState.push({
              type: 'm.room.encryption',
              state_key: '',
              content: { algorithm: 'm.megolm.v1.aes-sha2' }
            })
          }

          initialState.push({
            type: 'm.room.history_visibility',
            state_key: '',
            content: { history_visibility: 'shared' }
          })

          roomOptions.initial_state = initialState

          const createResult = await client.createRoom(roomOptions)

          const roomId = createResult.room_id

          // Manually invite users with MSC4268 shareEncryptedHistory option
          if (options.invite && options.invite.length > 0) {
            for (const userId of options.invite) {
              try {
                await client.invite(roomId, userId, { shareEncryptedHistory: true })
              } catch (error) {
                console.error(`Failed to invite user ${userId} to room ${roomId}`, error)
              }
            }
          }

          // Wait for Crypto and Member State to fully settle
          await new Promise((resolve) => {
            const checkReady = () => {
              const room = client.getRoom(roomId)
              if (!room) {
                return false
              }

              // Ensure the client knows this room is E2EE
              if (options.enableEncryption !== false && !client.isRoomEncrypted(roomId)) {
                return false
              }

              // Ensure the invited user is actually registered in the state
              if (options.invite && options.invite.length > 0) {
                for (const userId of options.invite) {
                  const member = room.getMember(userId)
                  if (!member || member.membership !== 'invite') {
                    return false
                  }
                }
              }

              return true
            }

            if (checkReady()) {
              return resolve()
            }

            const onStateEvent = (event) => {
              if (event.getRoomId() === roomId && checkReady()) {
                client.removeListener('RoomState.events', onStateEvent)
                resolve()
              }
            }
            client.on('RoomState.events', onStateEvent)
          })

          // Download keys and VERIFY devices exist
          if (options.invite && options.invite.length > 0) {
            for (const inviteUserId of options.invite) {
              try {
                const keys = await client.downloadKeys([inviteUserId], true)

                // Verify the user actually has devices uploaded to the homeserver
                const userDevices = keys[inviteUserId]
                if (!userDevices || Object.keys(userDevices).length === 0) {
                  console.warn(
                    `⚠️ CRITICAL: ${inviteUserId} has no devices on the server! ` +
                    `Any messages sent now CANNOT be decrypted by them later. ` +
                    `They must log in and sync at least once before receiving E2EE messages.`
                  )
                }
              } catch (error) {
                console.warn(`Failed to pre-fetch keys for ${inviteUserId}`, error)
              }
            }
          }

          // Small buffer to let the Rust crypto thread digest the downloaded keys
          await new Promise(r => setTimeout(r, 250))

          return createResult
        },
        inviteUser: globalContext => localContext => async (roomId, userId) => {
          /** @type {MatrixClient} */
          const client = localContext.values.getClient()
          if (!client) {
            throw new Error('Matrix client not initialized')
          }
          return await client.invite(roomId, userId, {
            shareEncryptedHistory: true
          })
        },
        joinRoom: globalContext => localContext => async roomId => {
          /** @type {MatrixClient} */
          const client = localContext.values.getClient()
          if (!client) {
            throw new Error('Matrix client not initialized')
          }

          // Send the HTTP request to join
          const joinResult = await client.joinRoom(roomId)

          // Wait for the local client to sync the room state via Events
          return new Promise((resolve) => {
            // Helper function to check if the room meets our criteria
            const checkReady = () => {
              const room = client.getRoom(roomId)

              if (room && room.hasMembershipState(client.getUserId(), 'join')) {
                if (room.hasEncryptionStateEvent()) {
                  // Give the Rust crypto layer a tiny buffer to initialize the encryptor
                  // after the m.room.encryption state event actually arrives.
                  setTimeout(() => resolve(joinResult), 300)
                } else {
                  // Not encrypted, ready immediately
                  resolve(joinResult)
                }
                return true
              }
              return false
            }

            // It might already be ready (e.g., if we were previously in the room)
            if (checkReady()) {
              return
            }

            // Fired when the room is added to the client
            const onRoom = (room) => {
              if (room.roomId === roomId && checkReady()) {
                cleanup()
              }
            }

            // Fired when state events (like m.room.encryption) arrive
            const onRoomStateEvent = (event) => {
              if (event.getRoomId() === roomId && checkReady()) {
                cleanup()
              }
            }

            // Helper to prevent memory leaks
            const cleanup = () => {
              client.removeListener('Room', onRoom)
              client.removeListener('RoomState.events', onRoomStateEvent)
              clearTimeout(timeoutId)
            }

            // Attach the listeners
            client.on('Room', onRoom)
            client.on('RoomState.events', onRoomStateEvent)

            // Safety fallback: if the sync hangs or events miss, resolve anyway after 5 seconds
            const timeoutId = setTimeout(() => {
              console.warn(`Timeout waiting for event-driven sync on room ${roomId}. Resolving.`)
              cleanup()
              resolve(joinResult)
            }, 5000)
          })
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

          return room.timeline.filter(event => {
            if (event.getType() === 'm.room.message') {
              return true
            }
            if (event.getType() === 'm.room.member' && event.getContent().membership === 'invite') {
              return true
            }
            return false
          }).map(event => {
            const eventId = event.getId()

            if (event.getType() === 'm.room.member' && event.getContent().membership === 'invite') {
              const targetId = event.getStateKey()
              const senderId = event.getSender()
              const senderName = room.getMember(senderId)?.name || senderId
              const targetName = room.getMember(targetId)?.name || targetId

              return {
                id: eventId,
                txnId: event.getTxnId(),
                status: event.status,
                sender: senderId,
                body: `${senderName} sent an invite to ${targetName}`,
                date: event.getDate(),
                msgtype: 'm.invite',
                info: {},
                reactions: {}
              }
            }

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
              } else if (event.getType() === 'm.room.member' && event.getContent().membership === 'invite') {
                const room = client.getRoom(roomId)
                const targetId = event.getStateKey()
                const senderId = event.getSender()
                const senderName = room?.getMember(senderId)?.name || senderId
                const targetName = room?.getMember(targetId)?.name || targetId

                callback({
                  id: event.getId(),
                  txnId: event.getTxnId(),
                  status: event.status,
                  sender: senderId,
                  body: `${senderName} sent an invite to ${targetName}`,
                  date: event.getDate(),
                  msgtype: 'm.invite',
                  info: {},
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
