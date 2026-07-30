import { definePlugin } from 'coralite'

/**
 * @typedef {Object} CustomWindow
 * @property {boolean} [__sync_complete__]
 */

/**
 * Real-time synchronization plugin for Atoll Chat.
 */
export default function syncPlugin () {
  return definePlugin({
    name: 'realtime-sync',
    client: {
      name: 'realtimeSync',
      context: (pluginContext) => {
        let isSubscribed = false

        return (instanceContext) => {
          const { pb } = instanceContext.pocketbase
          const { $worker } = instanceContext.cryptoWorker

          let catchUpPromise = null

          // Reset subscription state on logout to allow re-syncing on next login
          if (pluginContext.$bus) {
            pluginContext.$bus.on('auth:logout', () => {
              isSubscribed = false
              catchUpPromise = null
              console.log('[sync-plugin] Resetting subscription state and force disconnecting due to logout.')
              try {
                pb.realtime.disconnect()
                // Force-clear internal pocketbase realtime state to guarantee a clean reconnect on next login
                pb.realtime.clientId = ''
                pb.realtime.subscriptions = {}
                pb.realtime.reconnectAttempts = 0
                pb.realtime.lastSentSubscriptions = []
                pb.realtime.pendingConnects = []
                pb.realtime.pendingSubmits = []
                pb.realtime.isProcessingPendingSubmits = false
              } catch (err) {
                console.error('[sync-plugin] Error during realtime disconnect:', err)
              }
            })
          }
          const { $storage } = instanceContext.storage

          /**
           * Historical catch-up routine to recover missed messages and room keys.
           */
          const performCatchUpSync = async () => {
            const { $state } = instanceContext.globalStore

            if ($state.isCatchingUp && catchUpPromise) {
              console.info('[sync-plugin] Catch-up synchronization already in progress. Reusing existing promise.')
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
                // fetch missed room keys first
                const missedKeys = await pb.collection('room_members').getFullList({
                  filter: `user_id = "${pb.authStore.model.id}" && updated > "${lastRoomSyncTime}"`,
                  sort: 'updated'
                })

                // Process room keys in parallel for maximum speed
                const keyResults = await Promise.allSettled(missedKeys.map(record => $worker.execute('worker:process_new_room_key', record)))
                keyResults.forEach((res, idx) => {
                  if (res.status === 'rejected') {
                    console.warn(`[sync-plugin] Failed to process room key for record ${missedKeys[idx]?.id}:`, res.reason)
                  }
                })

                // Fetch missed messages SECOND
                const missedMessages = await pb.collection('messages').getFullList({
                  filter: `created > "${lastMsgSyncTime}"`,
                  sort: 'created'
                })

                // Process messages in parallel for maximum speed
                const msgResults = await Promise.allSettled(missedMessages.map(record => $worker.execute('worker:process_incoming_message', record)))
                msgResults.forEach((res, idx) => {
                  if (res.status === 'rejected') {
                    console.warn(`[sync-plugin] Failed to process incoming message ${missedMessages[idx]?.id}:`, res.reason)
                  }
                })

                // Notify UI that catch-up is done
                if (pluginContext.$bus) {
                  /** @type {CustomWindow & typeof globalThis} */
                  const win = window
                  win.__sync_complete__ = true
                  pluginContext.$bus.emit('sync:complete')
                }

                console.log('Historical catch-up synchronization complete.')
              } catch (err) {
                console.error('Critical failure during historical catch-up:', err)
                // Rethrow all errors to halt the sync process as requested
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
                console.info('[sync-plugin] App entered foreground. Triggering catch-up synchronization.')
                try {
                  await performCatchUpSync()
                } catch (err) {
                  console.error('[sync-plugin] Foreground sync catch-up failed:', err)
                }
              } else {
                console.info('[sync-plugin] App entered foreground but user is not authenticated or vault is locked. Skipping sync.')
              }
            })
          }

          const startSubscriptions = async () => {
            if (isSubscribed) {
              return
            }

            if (!pb.authStore.isValid) {
              console.warn('Cannot start real-time sync: User is not authenticated.')
              return
            }

            try {
              // Perform historical catch-up before starting live subscriptions
              await performCatchUpSync()

              // Subscribe to the messages collection
              await pb.collection('messages').subscribe('*', (e) => {
                if (e.action === 'create') {
                  // Fire-and-forget dispatch to the background worker
                  $worker.execute('worker:process_incoming_message', e.record).catch(console.error)
                }
              })

              // Subscribe to the room members collection
              await pb.collection('room_members').subscribe('*', async (e) => {
                if (e.action === 'create' || e.action === 'update') {
                  if (e.record.user_id === pb.authStore.model.id) {
                    // Own key update/invite
                    $worker.execute('worker:process_new_room_key', e.record).catch(console.error)
                  } else {
                    // Other member update (likely seen status)
                    $worker.execute('room:member_updated', e.record).catch(console.error)
                  }
                } else if (e.action === 'delete') {
                  if (e.record.user_id === pb.authStore.model.id) {
                    // User was removed from a room or deleted the chat
                    $worker.execute('worker:delete_local_room', { room_id: e.record.room_id }).catch(console.error)
                  }
                }
              })

              // Subscribe to the users collection (for profile updates)
              await pb.collection('users').subscribe('*', async (e) => {
                if ((e.action === 'update' || e.action === 'create') && e.record) {
                  // Dispatch to background worker for local database cache update
                  $worker.execute('worker:update_user_data', e.record).catch(console.error)

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
              console.log('Real-time subscriptions established.')
            } catch (err) {
              console.error('Failed to establish real-time subscriptions:', err)
            }
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
