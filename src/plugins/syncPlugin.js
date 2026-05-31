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
            const { pb, $worker } = instanceContext

            const startSubscriptions = async () => {
              if (isSubscribed) return

              const pbInstance = await pb()

              if (!pbInstance.authStore.isValid) {
                console.warn('Cannot start real-time sync: User is not authenticated.')
                return
              }

              try {
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
