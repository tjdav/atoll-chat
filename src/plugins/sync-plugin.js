import { definePlugin } from 'coralite'

/**
 * @typedef {Object} CustomWindow
 * @property {boolean} [__sync_complete__]
 */

/**
 * Real-time synchronization plugin for Atoll Chat.
 *
 * @returns {import('coralite').CoralitePlugin} The Coralite real-time sync plugin.
 */
export default function syncPlugin () {
  return definePlugin({
    name: 'realtime-sync',
    client: {
      name: 'realtimeSync',
      /**
       * Initializes the real-time sync plugin context.
       *
       * @param {Object} pluginContext - The plugin context.
       * @returns {function(Object): Object} The instance context resolver.
       */
      context: (pluginContext) => {
        let isSubscribed = false
        let catchUpPromise = null
        let lifecycleListenersRegistered = false
        let lastRoomSyncTime = null

        return (instanceContext) => {
          const { pb } = instanceContext.pocketbase
          const { $worker } = instanceContext.cryptoWorker
          const { $storage } = instanceContext.storage

          // Note: lifecycleListenersRegistered guard mirrors web-rtc-plugin.js isSignalingSetup
          if (!lifecycleListenersRegistered && pluginContext.$bus) {
            lifecycleListenersRegistered = true

            // Reset subscription state on logout to allow re-syncing on next login
            pluginContext.$bus.on('auth:logout', () => {
              isSubscribed = false
              catchUpPromise = null
              lastRoomSyncTime = null
              try {
                if (pb && pb.realtime) {
                  pb.realtime.disconnect()
                  // Force-clear internal pocketbase realtime state to guarantee a clean reconnect on next login
                  pb.realtime.clientId = ''
                  pb.realtime.subscriptions = {}
                  pb.realtime.reconnectAttempts = 0
                  pb.realtime.lastSentSubscriptions = []
                  pb.realtime.pendingConnects = []
                  pb.realtime.pendingSubmits = []
                  pb.realtime.isProcessingPendingSubmits = false
                }
              } catch (err) {
                // To comply with "NO SWALLOWED ERRORS", we explicitly re-throw unexpected errors.
                throw err
              }
            })

            pluginContext.$bus.on('app:foreground', async () => {
              const { $state } = instanceContext.globalStore
              if ($state.isAuthenticated && $state.isVaultUnlocked) {
                try {
                  await performCatchUpSync()
                } catch (err) {
                  console.error('[sync] Foreground sync catch-up failed:', err)
                  pluginContext.$bus.emit('ui:show_toast', {
                    message: `Foreground sync catch-up failed: ${err.message || err}`,
                    variant: 'danger'
                  })
                }
              }
            })
          }

          /**
           * Historical catch-up routine to recover missed messages and room keys.
           *
           * @returns {Promise<void>} Resolves when the catch-up process is complete.
           * @throws {Error} Re-throws any worker or PocketBase errors encountered during catch-up.
           */
          const performCatchUpSync = async () => {
            const { $state } = instanceContext.globalStore

            if ($state.isCatchingUp && catchUpPromise) {
              if (typeof window !== 'undefined') {
                window.__sync_reused__ = true
              }
              return catchUpPromise
            }

            $state.isCatchingUp = true

            catchUpPromise = (async () => {
              const lastMsgFromStorage = await $storage.getLatestGlobalMessage()

              const defaultDate = '2000-01-01 00:00:00.000Z'
              const lastMsgSyncTime = lastMsgFromStorage?.created_at
                ? new Date(lastMsgFromStorage.created_at).toISOString().replace('T', ' ')
                : defaultDate

              try {
                // Fetch room keys (use watermark filter if lastRoomSyncTime is set)
                const roomMembersFilter = lastRoomSyncTime
                  ? `user_id = "${pb.authStore.model.id}" && updated >= "${lastRoomSyncTime}"`
                  : `user_id = "${pb.authStore.model.id}"`

                const missedKeys = await pb.collection('room_members').getFullList({
                  filter: roomMembersFilter,
                  sort: 'updated'
                })

                // Process room keys in parallel. If any fails or has success === false, throw an Error.
                await Promise.all(
                  missedKeys.map(async (record) => {
                    const result = await $worker.execute('worker:process_new_room_key', record)
                    if (result && result.success === false) {
                      throw new Error(`Room key unwrapping failed for room ${record.room_id}: ${result.error}`)
                    }
                  })
                )

                // Fetch missed messages SECOND
                const missedMessages = await pb.collection('messages').getFullList({
                  filter: `created > "${lastMsgSyncTime}"`,
                  sort: 'created'
                })

                // Process messages in parallel with resilient error boundary
                const messageResults = await Promise.allSettled(
                  missedMessages.map(async (record) => {
                    const result = await $worker.execute('worker:process_incoming_message', record)
                    if (result && result.success === false) {
                      console.warn('[sync] Dropped invalid/unverified message during catch-up:', record.id, result.error)
                    }
                    return result
                  })
                )

                for (let i = 0; i < messageResults.length; i++) {
                  const res = messageResults[i]
                  if (res.status === 'rejected') {
                    console.warn('[sync] Dropped invalid/unverified message during catch-up:', missedMessages[i]?.id, res.reason)
                  }
                }

                // Flush pending replay buffer for any messages queued before or during catch-up
                try {
                  await $worker.execute('worker:flush_pending_messages')
                } catch (flushErr) {
                  console.warn('[sync] Failed to flush pending messages after catch-up:', flushErr)
                }

                lastRoomSyncTime = new Date().toISOString().replace('T', ' ')

                // Notify UI that catch-up is done
                $state.isCatchingUp = false
                if (pluginContext.$bus) {
                  /** @type {CustomWindow & typeof globalThis} */
                  const win = window
                  win.__sync_complete__ = true
                  pluginContext.$bus.emit('sync:complete')
                }
              } catch (err) {
                // Rethrow all errors to halt the sync process
                throw err
              }
            })()

            try {
              await catchUpPromise
            } finally {
              $state.isCatchingUp = false
              catchUpPromise = null
            }
          }


          /**
           * Establishes real-time subscriptions to PocketBase collections.
           *
           * @returns {Promise<void>} Resolves when real-time subscriptions are successfully set up.
           * @throws {Error} Propagates any PocketBase or worker failures to the caller.
           */
          const startSubscriptions = async () => {
            if (isSubscribed) {
              return
            }

            if (!pb.authStore.isValid) {
              return
            }

            // Perform historical catch-up before starting live subscriptions
            await performCatchUpSync()

            // Subscribe to the messages collection
            await pb.collection('messages').subscribe('*', (e) => {
              if (e.action === 'create') {
                $worker.execute('worker:process_incoming_message', e.record).then((result) => {
                  if (result && result.status === 'queued_for_key') {
                    console.info('[sync] Message queued awaiting room key:', e.record?.id, result.roomId)
                  } else if (result && result.success === false) {
                    console.warn('[sync] Dropped invalid/unverified incoming message:', e.record?.id, result.error)
                  }
                }).catch((err) => {
                  console.warn('[sync] Failed to process incoming message:', e.record?.id, err)
                })
              }
            })

            // Subscribe to the room members collection
            await pb.collection('room_members').subscribe('*', async (e) => {
              if (e.action === 'create' || e.action === 'update') {
                if (e.record.user_id === pb.authStore.model.id) {
                  // Own key update/invite
                  $worker.execute('worker:process_new_room_key', e.record).catch((err) => {
                    if (pluginContext.$bus) {
                      pluginContext.$bus.emit('ui:show_toast', {
                        message: `Failed to process new room key: ${err.message || err}`,
                        variant: 'danger'
                      })
                    }
                  })
                }
              } else if (e.action === 'delete') {
                if (e.record.user_id === pb.authStore.model.id) {
                  // User was removed from a room or deleted the chat
                  $worker.execute('worker:delete_local_room', { room_id: e.record.room_id }).catch((err) => {
                    if (pluginContext.$bus) {
                      pluginContext.$bus.emit('ui:show_toast', {
                        message: `Failed to delete local room: ${err.message || err}`,
                        variant: 'danger'
                      })
                    }
                  })
                }
              }
            })

            // Subscribe to the room settings collection
            await pb.collection('room_settings').subscribe('*', async (e) => {
              if (e.action === 'create' || e.action === 'update') {
                $worker.execute('room:settings_updated', e.record).catch((err) => {
                  if (pluginContext.$bus) {
                    pluginContext.$bus.emit('ui:show_toast', {
                      message: `Failed to update room settings: ${err.message || err}`,
                      variant: 'danger'
                    })
                  }
                })
              }
            })

            // Subscribe to the room member states collection
            await pb.collection('room_member_states').subscribe('*', async (e) => {
              if (e.action === 'create' || e.action === 'update') {
                $worker.execute('room:state_updated', e.record).catch((err) => {
                  if (pluginContext.$bus) {
                    pluginContext.$bus.emit('ui:show_toast', {
                      message: `Failed to update room member state: ${err.message || err}`,
                      variant: 'danger'
                    })
                  }
                })
              }
            })

            // Subscribe to the users collection (for profile updates)
            await pb.collection('users').subscribe('*', async (e) => {
              if ((e.action === 'update' || e.action === 'create') && e.record) {
                // Dispatch to background worker for local database cache update
                $worker.execute('worker:update_user_data', e.record).catch((err) => {
                  if (pluginContext.$bus) {
                    pluginContext.$bus.emit('ui:show_toast', {
                      message: `Failed to update user profile: ${err.message || err}`,
                      variant: 'danger'
                    })
                  }
                })

                // Update main thread globalStore users map
                const { $state } = instanceContext.globalStore
                $state.users = {
                  ...$state.users,
                  [e.record.id]: {
                    ...($state.users?.[e.record.id] || {}),
                    ...e.record
                  }
                }

                // Sync currentUser if matching ID
                if ($state.currentUser && $state.currentUser.id === e.record.id) {
                  $state.currentUser = {
                    ...$state.currentUser,
                    ...e.record
                  }
                }
              }
            })

            isSubscribed = true
          }

          return {
            $sync: {
              startSubscriptions
            }
          }
        }
      }
    }
  })
}
