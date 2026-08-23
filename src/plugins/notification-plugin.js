import { definePlugin } from 'coralite'

/**
 * Notification Plugin for Atoll Chat
 * Handles browser and native local notifications for new messages.
 */
export default definePlugin({
  name: 'notifications',
  client: {
    /**
     * Set up the initial client context for notifications.
     *
     * @returns {function(Object): Object} Resolver function for instance-specific notification operations.
     */
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

        let LocalNotifications = null

        /**
         * Initializes the notification plugin by setting up default state,
         * listening to new message events, and setting up local/native notifications.
         *
         * @returns {void}
         */
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

          /**
           * Sets up the Native Local Notifications listener and handles user clicks
           * to redirect them to the active room.
           *
           * @returns {Promise<void>}
           * @throws {Error} Re-throws unexpected module load or platform setup failures.
           */
          const setupLocalNotifications = async () => {
            try {
              const { Capacitor } = await import('@capacitor/core')
              if (Capacitor.isNativePlatform()) {
                const module = await import('@capacitor/local-notifications').catch(() => null)
                LocalNotifications = module ? module.LocalNotifications : null
                if (LocalNotifications) {
                  // Register the native local notification click/action listener
                  await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
                    const extra = action.notification.extra || {}
                    const roomId = extra.room_id
                    const messageId = extra.messageId
                    if (roomId) {
                      if (typeof window !== 'undefined' && typeof window.focus === 'function') {
                        window.focus()
                      }
                      $state.currentAppView = 'chats'
                      $state.activeSelectionType = 'chats'
                      $state.activeSelectionId = roomId

                      if (messageId) {
                        setTimeout(() => {
                          $bus.emit('message:scroll_to', { messageId })
                        }, 250)
                      }
                    }
                  })
                }
              }
            } catch (err) {
              if (err instanceof Error) {
                const isExpectedModuleNotFound =
                  err.code === 'ERR_MODULE_NOT_FOUND' ||
                  err.message.includes('Cannot find module') ||
                  err.message.includes('Failed to resolve')

                if (!isExpectedModuleNotFound) {
                  throw err
                }
              } else {
                throw err
              }
            }
          }
          setupLocalNotifications()

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
                  }
                } else {
                  $state.notificationsEnabled = false
                }
              } catch (err) {
                throw err
              }
            }
          })

          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', async (event) => {
              if (event.data && event.data.type === 'NOTIFICATION_CLICKED') {
                const { room_id, messageId } = event.data.payload || {}
                if (room_id) {
                  if (typeof window !== 'undefined' && typeof window.focus === 'function') {
                    window.focus()
                  }
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

          /**
           * Debounces and plays the designated message received sound,
           * supporting browser-enforced interaction policies gracefully.
           *
           * @returns {Promise<void>}
           * @throws {Error} Re-throws unexpected media file or system playback failures.
           */
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
              if (err instanceof Error) {
                const isExpectedMediaError =
                  err.name === 'NotAllowedError' ||
                  err.name === 'AbortError' ||
                  err.message.includes('play() can only be initiated by a user gesture') ||
                  err.message.includes('user gesture')

                if (!isExpectedMediaError) {
                  throw err
                }
              } else {
                throw err
              }
            }
          }

          /**
           * Checks whether the application is visible and the given room is actively opened.
           *
           * @param {string} roomId - The ID of the room to verify.
           * @returns {boolean} True if the chat is both active and visible.
           */
          const isChatActiveAndFocused = (roomId) => {
            const isAppVisible = typeof document !== 'undefined' &&
              document.visibilityState === 'visible'

            return isAppVisible &&
              $state.currentAppView === 'chats' &&
              $state.activeSelectionId === roomId
          }

          /**
           * Prepares the message parameters (sender, room type, content preview)
           * and dispatches a native local notification or fallback standard browser Notification.
           *
           * @param {Object} payload - The message payload object.
           * @param {string} payload.room_id - The ID of the chat room.
           * @param {Object} payload.message - The incoming message details.
           * @returns {Promise<void>}
           * @throws {Error} Re-throws unexpected system or notification scheduling exceptions.
           */
          const showNotification = async (payload) => {
            const { room_id, message } = payload
            if (!message || message.sender_id === $state.currentUser?.id) {
              return
            }

            if (isChatActiveAndFocused(room_id)) {
              return
            }

            if (($state.notificationsEnabled ?? true) === false) {
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
              } else if (message.type === 'voice') {
                body = 'Sent a voice message'
              } else if (message.type === 'media') {
                if (message.mime_type?.startsWith('image/')) {
                  body = 'Sent an image'
                } else if (message.mime_type?.startsWith('video/')) {
                  body = 'Sent a video'
                } else if (message.mime_type?.startsWith('audio/')) {
                  body = message.waveform_data ? 'Sent a voice message' : 'Sent an audio file'
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

              // Try Native Local Notification first if available
              if (LocalNotifications) {
                await LocalNotifications.schedule({
                  notifications: [
                    {
                      title,
                      body,
                      id: Date.now() % 100000,
                      extra: {
                        room_id,
                        messageId: message.id || message.local_uuid
                      }
                    }
                  ]
                })
                return
              }

              // Otherwise, fall back to standard Web browser Notification
              const isSupported = typeof Notification !== 'undefined'
              if (!isSupported || Notification.permission !== 'granted') {
                return
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
              throw err
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
              const isSuppressed = isChatActiveAndFocused(room_id)

              if (!isSuppressed) {
                playMessageSound()
              }
            }
          })
        }

        /**
         * Requests native or browser push/local notification permissions from the user.
         *
         * @returns {Promise<boolean>} True if the permission request was successful/granted.
         * @throws {Error} Re-throws unexpected system, plugin, or permission exceptions.
         */
        const requestPermission = async () => {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            try {
              const module = await import('@capacitor/local-notifications').catch(() => null)
              const localNotif = module ? module.LocalNotifications : LocalNotifications
              if (localNotif) {
                const status = await localNotif.requestPermissions()
                return status.display === 'granted'
              }
            } catch (err) {
              if (err instanceof Error) {
                const isExpectedModuleNotFound =
                  err.code === 'ERR_MODULE_NOT_FOUND' ||
                  err.message.includes('Cannot find module') ||
                  err.message.includes('Failed to resolve')

                if (!isExpectedModuleNotFound) {
                  throw err
                }
              } else {
                throw err
              }
            }
            return true
          }

          if (!('Notification' in window)) {
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
