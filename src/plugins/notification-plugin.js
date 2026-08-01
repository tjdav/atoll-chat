import { definePlugin } from 'coralite'

/**
 * Notification Plugin for Atoll Chat
 * Handles browser notifications for new messages.
 */
export default definePlugin({
  name: 'notifications',
  client: {
    context: () => {
      let lastSoundPlayTime = 0
      let isInitialized = false

      return (instanceContext) => {
        const { $bus } = instanceContext.eventBus
        const { $state } = instanceContext.globalStore
        const { $storage } = instanceContext.storage
        const { pb } = instanceContext.pocketbase
        const { config } = instanceContext
        const { $push } = instanceContext.push

        const init = () => {
          if (isInitialized) {
            return
          }
          isInitialized = true

          if ($state.notificationsEnabled === undefined) {
            $state.notificationsEnabled = true
          }
          if ($state.messageSoundsEnabled === undefined) {
            $state.messageSoundsEnabled = true
          }

          $state.subscribe('isVaultUnlocked', async (unlocked) => {
            if (!unlocked) {
              return
            }

            if ($state.notificationsEnabled === undefined) {
              $state.notificationsEnabled = true
            }

            if ($state.notificationsEnabled === false) {
              return
            }

            const userModel = pb.authStore.record || pb.authStore.model
            const userId = $state.currentUser?.id || userModel?.id
            const storageKey = userId ? `atoll_notif_prompted_${userId}` : 'atoll_notif_prompted'
            const alreadyPrompted = localStorage.getItem(storageKey) === 'true'

            const needsPrompt = !alreadyPrompted || (typeof Notification !== 'undefined' && Notification.permission === 'default')

            if (needsPrompt) {
              try {
                const granted = await $push.requestPermission()

                localStorage.setItem(storageKey, 'true')

                if (granted) {
                  $state.notificationsEnabled = true
                  const token = await $push.register()
                  if (token && userModel) {
                    await pb.collection('users').update(userModel.id, {
                      push_subscription: token
                    })
                    console.log('[notification-plugin] Push registration successful on vault unlock:', token)
                  }
                } else {
                  $state.notificationsEnabled = false
                }
              } catch (err) {
                console.error('[notification-plugin] Failed to request permission on vault unlock:', err)
              }
            }
          })

          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', async (event) => {
              if (event.data && event.data.type === 'NOTIFICATION_CLICKED') {
                const { room_id, messageId } = event.data.payload || {}
                if (room_id) {
                  $state.currentAppView = 'chats'
                  $state.activeSelectionType = 'chats'
                  $state.activeSelectionId = room_id

                  if (messageId) {
                    $bus.emit('message:scroll_to', { messageId })
                  }
                }
              }
            })
          }

          try {
            const params = new URLSearchParams(window.location.search)
            const urlMessageId = params.get('messageId')
            const urlRoomId = params.get('id')
            if (urlMessageId && urlRoomId) {
              let unSub
              unSub = $state.subscribe('isVaultUnlocked', (unlocked) => {
                if (unlocked) {
                  setTimeout(() => {
                    $bus.emit('message:scroll_to', { messageId: urlMessageId })
                  }, 1500)
                  if (unSub) {
                    unSub()
                  } else {
                    setTimeout(() => unSub(), 0)
                  }
                }
              })
            }
          } catch (err) {
            console.error('[notification-plugin] Failed to parse URL messageId:', err)
          }

          const playMessageSound = async () => {
            if (($state.messageSoundsEnabled ?? true) === false) {
              return
            }

            const now = Date.now()
            const debounceMs = config.$config.get('notificationSoundDebounceMs') ?? 1000

            if (now - lastSoundPlayTime < debounceMs) {
              return
            }

            lastSoundPlayTime = now

            try {
              let audioSource = '/sounds/notification.mp3'
              const customSound = await $storage.getConfig('custom_message_sound')
              if (customSound && customSound instanceof Blob) {
                audioSource = URL.createObjectURL(customSound)
              }

              const audio = new Audio(audioSource)
              audio.volume = $state.mediaVolume || 1.0
              await audio.play()

              if (audioSource.startsWith('blob:')) {
                audio.onended = () => URL.revokeObjectURL(audioSource)
              }
            } catch (err) {
              console.error('[notification-plugin] Failed to play message sound:', err)
            }
          }

          const showNotification = async (payload) => {
            if (($state.notificationsEnabled ?? true) === false || Notification.permission !== 'granted') {
              return
            }

            const { room_id, message } = payload
            if (!message || message.sender_id === $state.currentUser?.id) {
              return
            }

            if (document.visibilityState === 'visible' &&
                  $state.currentAppView === 'chats' &&
                  $state.activeSelectionId === room_id) {
              return
            }

            try {
              if (!room_id) {
                return
              }
              const room = await $storage.getRoom(room_id)
              if (!room) {
                return
              }

              const me = room.participants.find(p => p.id === $state.currentUser?.id)
              if (me?.is_muted) {
                return
              }

              const sender = room.participants.find(p => p.id === message.sender_id)
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

              if (body.length > 160) {
                body = body.substring(0, 157) + '...'
              }

              const options = {
                body,
                icon: '/icon-192x192.png',
                tag: room_id,
                renotify: true,
                data: {
                  room_id,
                  messageId: message.id || message.local_uuid
                }
              }

              if (sender && sender.avatar) {
                options.image = pb.files.getURL(sender, sender.avatar, { thumb: '160x160' })
                options.icon = pb.files.getURL(sender, sender.avatar, { thumb: '128x128' })
              }

              const notification = new Notification(title, options)

              notification.onclick = (event) => {
                event.preventDefault()
                window.focus()

                $state.currentAppView = 'chats'
                $state.activeSelectionType = 'chats'
                $state.activeSelectionId = room_id

                $bus.emit('message:scroll_to', { messageId: message.id || message.local_uuid })
                notification.close()
              }
            } catch (err) {
              console.error('[notification-plugin] Failed to show notification:', err)
            }
          }

          $bus.on('db:new_local_data', async (payload) => {
            const isCatchingUp = $state.isCatchingUp
            const { room_id, message } = payload
            if (!message || message.sender_id === $state.currentUser?.id) {
              return
            }

            if (isCatchingUp) {
              return
            }

            if (!room_id) {
              return
            }

            const room = await $storage.getRoom(room_id)
            const me = room.participants.find(p => p.id === $state.currentUser?.id)
            const isMuted = me?.is_muted

            if (!isMuted) {
              showNotification(payload)
            }

            if ($state.messageSoundsEnabled && !isMuted) {
              const isSuppressed = document.visibilityState === 'visible' &&
                $state.currentAppView === 'chats' &&
                $state.activeSelectionId === room_id

              if (!isSuppressed) {
                playMessageSound()
              }
            }
          })
        }

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

        return {
          init,
          $notifications: {
            requestPermission
          }
        }
      }
    }
  }
})
