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

        return (instanceContext) => {
          const { pb } = instanceContext.pocketbase
          const { $worker } = instanceContext.cryptoWorker
          const { $storage } = instanceContext.storage

          let catchUpPromise = null

          // Reset subscription state on logout to allow re-syncing on next login
          if (pluginContext.$bus) {
            pluginContext.$bus.on('auth:logout', () => {
              isSubscribed = false
              catchUpPromise = null
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
              const lastRoomFromStorage = await $storage.getLatestGlobalRoom()

              const defaultDate = '2000-01-01 00:00:00.000Z'
              const lastMsgSyncTime = lastMsgFromStorage?.created_at
                ? new Date(lastMsgFromStorage.created_at).toISOString().replace('T', ' ')
                : defaultDate
              const lastRoomSyncTime = lastRoomFromStorage?.updated_at
                ? new Date(lastRoomFromStorage.updated_at).toISOString().replace('T', ' ')
                : defaultDate

              try {
                // Fetch missed room keys first
                const missedKeys = await pb.collection('room_members').getFullList({
                  filter: `user_id = "${pb.authStore.model.id}" && updated > "${lastRoomSyncTime}"`,
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

                // Process messages in parallel
                await Promise.all(
                  missedMessages.map((record) => $worker.execute('worker:process_incoming_message', record))
                )

                // Notify UI that catch-up is done
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

          if (pluginContext.$bus) {
            pluginContext.$bus.on('app:foreground', async () => {
              const { $state } = instanceContext.globalStore
              if ($state.isAuthenticated && $state.isVaultUnlocked) {
                try {
                  await performCatchUpSync()
                } catch (err) {
                  pluginContext.$bus.emit('ui:show_toast', {
                    message: `Foreground sync catch-up failed: ${err.message || err}`,
                    variant: 'danger'
                  })
                }
              }
            })
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
                $worker.execute('worker:process_incoming_message', e.record).catch((err) => {
                  if (pluginContext.$bus) {
                    pluginContext.$bus.emit('ui:show_toast', {
                      message: `Failed to process incoming message: ${err.message || err}`,
                      variant: 'danger'
                    })
                  }
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
