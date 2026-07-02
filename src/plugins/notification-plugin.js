import { definePlugin } from 'coralite'

/**
 * Notification Plugin for Atoll Chat
 * Handles browser notifications for new messages.
 */
export default definePlugin({
  name: 'notifications',
  client: {
    context: () => {
      return (instanceContext) => {
        const { $bus } = instanceContext.eventBus
        const { $state } = instanceContext.globalStore
        const { $localDb } = instanceContext.localDb
        const { pb } = instanceContext.pocketbase

        const requestPermission = async () => {
          if (!('Notification' in window)) {
            console.warn('This browser does not support notifications.')
            return false
          }

          if (Notification.permission === 'granted') {
            return true
          }

          if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission()
            return permission === 'granted'
          }

          return false
        }

        const showNotification = async (payload) => {
          if (!$state.notificationsEnabled || Notification.permission !== 'granted') {
            return
          }

          const { room_id: roomId, message } = payload
          if (!message || message.sender_id === $state.currentUser?.id) {
            return
          }

          // Suppress if the user is already looking at this chat and the window is focused
          if (document.visibilityState === 'visible' &&
                $state.currentAppView === 'chats' &&
                $state.activeSelectionId === roomId) {
            return
          }

          try {
            const room = await $localDb.local_rooms.get(roomId)
            if (!room) {
              return
            }

            const sender = room.participants?.find(p => p.id === message.sender_id)
            const senderName = sender?.username || 'Someone'

            let title = senderName
            if (room.is_group) {
              const roomName = room.name || 'Group'
              title = `${senderName} in ${roomName}`
            }

            let body = ''
            if (message.type === 'text') {
              body = message.content
            } else if (message.type === 'media') {
              if (message.mime_type?.startsWith('image/')) {
                body = 'Sent an image'
              } else if (message.mime_type?.startsWith('video/')) {
                body = 'Sent a video'
              } else if (message.mime_type?.startsWith('audio/')) {
                body = 'Sent a voice message'
              } else {
                body = 'Sent a file'
              }
            } else if (message.type === 'link') {
              body = 'Shared a link'
            } else if (message.type === 'call_offer') {
              body = 'Incoming call...'
            } else {
              return
            }

            // Truncate body
            if (body.length > 160) {
              body = body.substring(0, 157) + '...'
            }

            const options = {
              body,
              icon: '/images/icon-coralite.avif',
              tag: roomId,
              renotify: true,
              data: {
                roomId,
                messageId: message.id || message.local_uuid
              }
            }

            if (sender && sender.avatar) {
              options.image = pb.files.getURL(sender, sender.avatar, { thumb: '160x160' })
              // Browser might use icon for the small image and image for the large one.
              // For a chat notification, usually the icon is the sender's avatar.
              options.icon = pb.files.getURL(sender, sender.avatar, { thumb: '128x128' })
            }

            const notification = new Notification(title, options)

            notification.onclick = (event) => {
              event.preventDefault()
              window.focus()

              $state.currentAppView = 'chats'
              $state.activeSelectionType = 'chats'
              $state.activeSelectionId = roomId

              // Use the existing SCROLL_TO_MESSAGE mechanism
              $bus.emit('SCROLL_TO_MESSAGE', { messageId: message.id || message.local_uuid })
              notification.close()
            }
          } catch (err) {
            console.error('[notification-plugin] Failed to show notification:', err)
          }
        }

        $bus.on('NEW_LOCAL_DATA', (payload) => {
          showNotification(payload)
        })

        return {
          $notifications: {
            requestPermission
          }
        }
      }
    }
  }
})
