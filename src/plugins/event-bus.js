import { createPlugin } from 'coralite'

export default createPlugin({
  name: 'event-bus-plugin',
  client: {
    imports: [
      {
        specifier: 'valibot',
        namedExports: ['strictObject', 'optional', 'pipe', 'string', 'minLength', 'boolean', 'fallback', 'instance', 'picklist', 'any', 'number', 'array', 'safeParse']
      }
    ],
    setup (context) {
      const { strictObject, optional, pipe, string, minLength, boolean, fallback, instance, picklist, any, number, array, safeParse } = context.imports
      // Define the secure events and their schemas privately inside the module
      const ChatEvents = {
        'app:logged-in': {
          id: Symbol('app:logged-in'),
          schema: optional(strictObject({}))
        },
        'app:logged-out': {
          id: Symbol('app:logged-out'),
          schema: optional(strictObject({}))
        },
        'chat:rooms-updated': {
          id: Symbol('chat:rooms-updated'),
          schema: optional(strictObject({}))
        },
        'chat:room-selected': {
          id: Symbol('chat:room-selected'),
          schema: strictObject({
            roomId: pipe(string(), minLength(1))
          })
        },
        'chat:room-ready': {
          id: Symbol('chat:room-ready'),
          schema: strictObject({
            roomId: pipe(string(), minLength(1))
          })
        },
        'chat:message-submitted': {
          id: Symbol('chat:message-submitted'),
          schema: strictObject({
            text: string()
          })
        },
        'chat:message-sent': {
          id: Symbol('chat:message-sent'),
          schema: optional(strictObject({}))
        },
        'chat:message-received': {
          id: Symbol('chat:message-received'),
          schema: strictObject({
            text: string(),
            encrypted: fallback(boolean(), true)
          })
        },
        'chat:file-selected': {
          id: Symbol('chat:file-selected'),
          schema: strictObject({
            file: instance(File)
          })
        },
        'chat:file-processing-done': {
          id: Symbol('chat:file-processing-done'),
          schema: optional(strictObject({}))
        },
        'auth:show-signup': {
          id: Symbol('auth:show-signup'),
          schema: optional(strictObject({}))
        },
        'auth:show-login': {
          id: Symbol('auth:show-login'),
          schema: optional(strictObject({}))
        },
        'nav:changed': {
          id: Symbol('nav:changed'),
          schema: strictObject({
            tab: string()
          })
        },
        'nav:jump-to-message': {
          id: Symbol('nav:jump-to-message'),
          schema: strictObject({
            roomId: string(),
            eventId: string()
          })
        },
        'chat:scroll-to-message': {
          id: Symbol('chat:scroll-to-message'),
          schema: strictObject({
            eventId: string()
          })
        },
        'call:incoming': {
          id: Symbol('call:incoming'),
          schema: strictObject({
            call: any()
          })
        },
        'call:start': {
          id: Symbol('call:start'),
          schema: strictObject({
            roomId: pipe(string(), minLength(1)),
            type: picklist(['video', 'voice'])
          })
        },
        'call:answered': {
          id: Symbol('call:answered'),
          schema: strictObject({
            call: any()
          })
        },
        'call:rejected': {
          id: Symbol('call:rejected'),
          schema: strictObject({
            call: any()
          })
        },
        'player:play-state-change': {
          id: Symbol('player:play-state-change'),
          schema: strictObject({ isPlaying: boolean() })
        },
        'player:shuffle-change': {
          id: Symbol('player:shuffle-change'),
          schema: strictObject({ isShuffle: boolean() })
        },
        'player:repeat-change': {
          id: Symbol('player:repeat-change'),
          schema: strictObject({ repeatMode: string() })
        },
        'player:toggle-play': {
          id: Symbol('player:toggle-play'),
          schema: optional(strictObject({}))
        },
        'player:next': {
          id: Symbol('player:next'),
          schema: optional(strictObject({}))
        },
        'player:previous': {
          id: Symbol('player:previous'),
          schema: optional(strictObject({}))
        },
        'player:toggle-shuffle': {
          id: Symbol('player:toggle-shuffle'),
          schema: optional(strictObject({}))
        },
        'player:toggle-repeat': {
          id: Symbol('player:toggle-repeat'),
          schema: optional(strictObject({}))
        },
        'player:seek': {
          id: Symbol('player:seek'),
          schema: strictObject({ time: number() })
        },
        'player:set-volume': {
          id: Symbol('player:set-volume'),
          schema: strictObject({ volume: number() })
        },
        'player:toggle-mute': {
          id: Symbol('player:toggle-mute'),
          schema: optional(strictObject({}))
        },
        'player:toggle-queue': {
          id: Symbol('player:toggle-queue'),
          schema: optional(strictObject({}))
        },
        'player:close-queue': {
          id: Symbol('player:close-queue'),
          schema: optional(strictObject({}))
        },
        'player:play-queue-track': {
          id: Symbol('player:play-queue-track'),
          schema: strictObject({
            index: number(),
            file: any()
          })
        },
        'player:toggle-like': {
          id: Symbol('player:toggle-like'),
          schema: strictObject({ file: any() })
        },
        'player:track-update': {
          id: Symbol('player:track-update'),
          schema: strictObject({
            file: any(),
            isLiked: boolean()
          })
        },
        'player:like-update': {
          id: Symbol('player:like-update'),
          schema: strictObject({
            fileId: string(),
            isLiked: boolean()
          })
        },
        'player:queue-update': {
          id: Symbol('player:queue-update'),
          schema: strictObject({
            playlist: array(any()),
            index: number()
          })
        },
        'player:queue-visibility': {
          id: Symbol('player:queue-visibility'),
          schema: strictObject({ isVisible: boolean() })
        },
        'player:time-update': {
          id: Symbol('player:time-update'),
          schema: strictObject({ currentTime: number() })
        },
        'player:duration-change': {
          id: Symbol('player:duration-change'),
          schema: strictObject({ duration: number() })
        },
        'player:volume-update': {
          id: Symbol('player:volume-update'),
          schema: strictObject({
            volume: number(),
            isMuted: boolean()
          })
        },
        'audio:play': {
          id: Symbol('audio:play'),
          schema: strictObject({
            file: any(),
            playlist: optional(array(any())),
            index: optional(number())
          })
        },
        'call:ended': {
          id: Symbol('call:ended'),
          schema: strictObject({
            call: any()
          })
        }
      }

      // The Broker Constructor
      function SymbolicEventBroker () {
        this.listeners = new Map()
      }

      SymbolicEventBroker.prototype.on = function (eventDef, callback) {
        const sym = eventDef?.id
        if (typeof sym !== 'symbol') throw new Error('Security Error: Invalid event.')

        if (!this.listeners.has(sym)) {
          this.listeners.set(sym, new Set())
        }

        this.listeners.get(sym).add(callback)
        return () => {
          const callbacks = this.listeners.get(sym)
          if (callbacks) callbacks.delete(callback)
        }
      }

      SymbolicEventBroker.prototype.emit = function (eventDef, detail) {
        const sym = eventDef?.id
        if (typeof sym !== 'symbol') throw new Error('Security Error: Invalid event.')
        if (!eventDef.schema) throw new Error('Security Error: Missing Valibot schema.')

        // Validation Gate
        const validation = safeParse(eventDef.schema, detail)
        if (!validation.success) {
          console.warn('[Security] Dropped malformed payload.', validation.issues)
          return
        }

        const callbacks = this.listeners.get(sym)
        if (callbacks) {
          callbacks.forEach(cb => cb(validation.output))
        }
      }

      return {
        ChatEvents,
        globalBroker: new SymbolicEventBroker()
      }
    },
    helpers: {
      events: (globalContext) => (localContext) => (id) => localContext.values.ChatEvents[id],

      emit: (globalContext) => (localContext) => (eventDef, detail) => {
        localContext.values.globalBroker.emit(eventDef, detail)
      },
      on: (globalContext) => (localContext) => (eventDef, callback) => {
        return localContext.values.globalBroker.on(eventDef, callback)
      }
    }
  }
})
