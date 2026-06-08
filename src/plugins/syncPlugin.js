import { definePlugin } from 'coralite'

/**
 * Real-time synchronization plugin for Atoll Chat.
 */
export default function syncPlugin () {
  let isSubscribed = false

  return definePlugin({
    name: 'realtime-sync',
    client: {
      name: 'realtimeSync',
      context: {
        $sync: (globalContext) => {
          const pb = globalContext.pocketbase.pb
          const $worker = globalContext.cryptoWorker.$worker
          const $localDb = globalContext.localDb.$localDb
          /**
           * Historical catch-up routine to recover missed messages and room keys.
           */
          const performCatchUpSync = async () => {
            const db = $localDb

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
              // Fetch missed messages
              const missedMessages = await pb.collection('messages').getFullList({
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

              // Fetch missed room keys (invites/epochs)
              const missedKeys = await pb.collection('room_members').getFullList({
                filter: `user_id = "${pb.authStore.model.id}" && updated > "${lastRoomSyncTime}"`,
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
                  $worker.execute('PROCESS_INCOMING_MESSAGE', e.record).catch(console.error)
                }
              })

              // Subscribe to the room members collection
              await pb.collection('room_members').subscribe('*', (e) => {
                if (e.action === 'create' || e.action === 'update') {
                  // Fire-and-forget dispatch to the background worker
                  $worker.execute('PROCESS_NEW_ROOM_KEY', e.record).catch(console.error)
                }
              }, {
                filter: `user_id = "${pb.authStore.model.id}"`
              })

              isSubscribed = true
              console.log('Real-time subscriptions established.')
            } catch (err) {
              console.error('Failed to establish real-time subscriptions:', err)
            }
          }
          return () => {
            return {
              startSubscriptions
            }
          }
        }
      }
    }
  })
}
