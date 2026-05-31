import { definePlugin } from 'coralite'

/**
 * Real-time synchronization plugin for Atoll Chat.
 */
export default function syncPlugin () {
  let isSubscribed = false

  return definePlugin({
    name: 'realtime-sync',
    client: {
      context: {
        $sync: (globalContext) => {
          return (instanceContext) => {
            const { pb, $worker, $localDb } = instanceContext

            /**
             * Historical catch-up routine to recover missed messages and room keys.
             */
            const performCatchUpSync = async () => {
              const pbInstance = await pb()
              const db = $localDb

              // 1. Determine High-Water Marks
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
                // 2. Fetch Missed Messages
                const missedMessages = await pbInstance.collection('messages').getFullList({
                  filter: `created > "${lastMsgSyncTime}"`,
                  sort: 'created'
                })

                for (const record of missedMessages) {
                  try {
                    await $worker.execute('PROCESS_INCOMING_MESSAGE', record)
                  } catch (err) {
                    console.error(`Failed to process caught-up message ${record.id}:`, err)
                  }
                }

                // 3. Fetch Missed Room Keys (Invites/Epochs)
                const missedKeys = await pbInstance.collection('room_members').getFullList({
                  filter: `user_id = "${pbInstance.authStore.model.id}" && updated > "${lastRoomSyncTime}"`,
                  sort: 'updated'
                })

                for (const record of missedKeys) {
                  try {
                    await $worker.execute('PROCESS_NEW_ROOM_KEY', record)
                  } catch (err) {
                    console.error(`Failed to process caught-up room key ${record.id}:`, err)
                  }
                }

                console.log('Historical catch-up synchronization complete.')
              } catch (err) {
                console.error('Critical failure during historical catch-up:', err)
                // If it's a network error, we re-throw to potentially halt subscription start
                if (err.status === 0 || err.name === 'ClientResponseError') {
                  throw err
                }
              }
            }

            const startSubscriptions = async () => {
              if (isSubscribed) {
                return
              }

              const pbInstance = await pb()

              if (!pbInstance.authStore.isValid) {
                console.warn('Cannot start real-time sync: User is not authenticated.')
                return
              }

              try {
                // Perform historical catch-up before starting live subscriptions
                await performCatchUpSync()

                // Subscribe to the messages collection
                await pbInstance.collection('messages').subscribe('*', (e) => {
                  if (e.action === 'create') {
                    // Fire-and-forget dispatch to the background worker
                    $worker.execute('PROCESS_INCOMING_MESSAGE', e.record).catch(console.error)
                  }
                })

                // Subscribe to the room members collection
                await pbInstance.collection('room_members').subscribe('*', (e) => {
                  if (e.action === 'create' || e.action === 'update') {
                    // Fire-and-forget dispatch to the background worker
                    $worker.execute('PROCESS_NEW_ROOM_KEY', e.record).catch(console.error)
                  }
                }, {
                  filter: `user_id = "${pbInstance.authStore.model.id}"`
                })

                isSubscribed = true
                console.log('Real-time subscriptions established.')
              } catch (err) {
                console.error('Failed to establish real-time subscriptions:', err)
              }
            }

            return {
              startSubscriptions
            }
          }
        }
      }
    }
  })
}
