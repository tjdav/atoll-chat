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

          // Reset subscription state on logout to allow re-syncing on next login
          if (pluginContext.$bus) {
            pluginContext.$bus.on('auth:logout', () => {
              isSubscribed = false
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
          const { $localDb } = instanceContext.localDb

          /**
           * Historical catch-up routine to recover missed messages and room keys.
           */
          const performCatchUpSync = async () => {
            const { $state } = instanceContext.globalStore
            const db = $localDb

            $state.isCatchingUp = true

            // Determine high-water marks
            const lastMsg = await db.local_messages.orderBy('created_at').last()
            const lastRoom = await db.local_rooms.orderBy('updated_at').last()

            const defaultDate = '2000-01-01 00:00:00.000Z'
            const lastMsgSyncTime = lastMsg?.created_at
              ? new Date(lastMsg.created_at).toISOString().replace('T', ' ')
              : defaultDate
            const lastRoomSyncTime = lastRoom?.updated_at
              ? new Date(lastRoom.updated_at).toISOString().replace('T', ' ')
              : defaultDate

            try {
              // fetch missed room keys first
              const missedKeys = await pb.collection('room_members').getFullList({
                filter: `user_id = "${pb.authStore.model.id}" && updated > "${lastRoomSyncTime}"`,
                sort: 'updated'
              })

              // Process room keys in parallel for maximum speed
              await Promise.all(missedKeys.map(record => $worker.execute('worker:process_new_room_key', record)))

              // Fetch missed messages SECOND
              const missedMessages = await pb.collection('messages').getFullList({
                filter: `created > "${lastMsgSyncTime}"`,
                sort: 'created'
              })

              // Process messages in parallel for maximum speed
              await Promise.all(missedMessages.map(record => $worker.execute('worker:process_incoming_message', record)))

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
            } finally {
              $state.isCatchingUp = false
            }
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
                if (e.action === 'update') {
                  $worker.execute('worker:update_user_data', e.record).catch(console.error)
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
