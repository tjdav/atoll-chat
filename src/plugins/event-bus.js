import { createPlugin } from 'coralite'
import { z } from 'zod'


export default createPlugin({
  name: 'event-bus-plugin',
  client: {
    imports: [
      {
        specifier: 'zod',
        namespaceExport: 'z'
      }
    ],
    setup (context) {
      const z = context.imports.z
      // Define the secure events and their schemas privately inside the module
      const ChatEvents = {
        'app:logged-in': {
          id: Symbol('app:logged-in'),
          schema: z.object({}).strict().optional()
        },
        'app:logged-out': {
          id: Symbol('app:logged-out'),
          schema: z.object({}).strict().optional()
        },
        'chat:rooms-updated': {
          id: Symbol('chat:rooms-updated'),
          schema: z.object({}).strict().optional()
        },
        'chat:room-selected': {
          id: Symbol('chat:room-selected'),
          schema: z.object({
            roomId: z.string().min(1)
          })
        },
        'chat:room-ready': {
          id: Symbol('chat:room-ready'),
          schema: z.object({
            roomId: z.string().min(1)
          })
        },
        'chat:message-submitted': {
          id: Symbol('chat:message-submitted'),
          schema: z.object({
            text: z.string()
          })
        },
        'chat:message-sent': {
          id: Symbol('chat:message-sent'),
          schema: z.object({}).strict().optional()
        },
        'chat:message-received': {
          id: Symbol('chat:message-received'),
          schema: z.object({
            text: z.string(),
            encrypted: z.boolean().default(true)
          })
        },
        'chat:file-selected': {
          id: Symbol('chat:file-selected'),
          schema: z.object({
            file: z.instanceof(File)
          })
        },
        'chat:file-processing-done': {
          id: Symbol('chat:file-processing-done'),
          schema: z.object({}).strict().optional()
        },
        'auth:show-signup': {
          id: Symbol('auth:show-signup'),
          schema: z.object({}).strict().optional()
        },
        'auth:show-login': {
          id: Symbol('auth:show-login'),
          schema: z.object({}).strict().optional()
        },
        'nav:changed': {
          id: Symbol('nav:changed'),
          schema: z.object({
            tab: z.string()
          }).strict()
        },
        'nav:jump-to-message': {
          id: Symbol('nav:jump-to-message'),
          schema: z.object({
            roomId: z.string(),
            eventId: z.string()
          }).strict()
        },
        'chat:scroll-to-message': {
          id: Symbol('chat:scroll-to-message'),
          schema: z.object({
            eventId: z.string()
          }).strict()
        },
        'call:incoming': {
          id: Symbol('call:incoming'),
          schema: z.object({
            call: z.any()
          }).strict()
        },
        'call:start': {
          id: Symbol('call:start'),
          schema: z.object({
            roomId: z.string().min(1),
            type: z.enum(['video', 'voice'])
          }).strict()
        },
        'call:answered': {
          id: Symbol('call:answered'),
          schema: z.object({
            call: z.any()
          }).strict()
        },
        'call:rejected': {
          id: Symbol('call:rejected'),
          schema: z.object({
            call: z.any()
          }).strict()
        },
        'player:play-state-change': {
          id: Symbol('player:play-state-change'),
          schema: z.object({ isPlaying: z.boolean() }).strict()
        },
        'player:shuffle-change': {
          id: Symbol('player:shuffle-change'),
          schema: z.object({ isShuffle: z.boolean() }).strict()
        },
        'player:repeat-change': {
          id: Symbol('player:repeat-change'),
          schema: z.object({ repeatMode: z.string() }).strict()
        },
        'player:toggle-play': {
          id: Symbol('player:toggle-play'),
          schema: z.object({}).strict().optional()
        },
        'player:next': {
          id: Symbol('player:next'),
          schema: z.object({}).strict().optional()
        },
        'player:previous': {
          id: Symbol('player:previous'),
          schema: z.object({}).strict().optional()
        },
        'player:toggle-shuffle': {
          id: Symbol('player:toggle-shuffle'),
          schema: z.object({}).strict().optional()
        },
        'player:toggle-repeat': {
          id: Symbol('player:toggle-repeat'),
          schema: z.object({}).strict().optional()
        },
        'player:seek': {
          id: Symbol('player:seek'),
          schema: z.object({ time: z.number() }).strict()
        },
        'player:set-volume': {
          id: Symbol('player:set-volume'),
          schema: z.object({ volume: z.number() }).strict()
        },
        'player:toggle-mute': {
          id: Symbol('player:toggle-mute'),
          schema: z.object({}).strict().optional()
        },
        'player:toggle-queue': {
          id: Symbol('player:toggle-queue'),
          schema: z.object({}).strict().optional()
        },
        'player:close-queue': {
          id: Symbol('player:close-queue'),
          schema: z.object({}).strict().optional()
        },
        'player:play-queue-track': {
          id: Symbol('player:play-queue-track'),
          schema: z.object({
            index: z.number(),
            file: z.any()
          }).strict()
        },
        'player:toggle-like': {
          id: Symbol('player:toggle-like'),
          schema: z.object({ file: z.any() }).strict()
        },
        'player:track-update': {
          id: Symbol('player:track-update'),
          schema: z.object({
            file: z.any(),
            isLiked: z.boolean()
          }).strict()
        },
        'player:like-update': {
          id: Symbol('player:like-update'),
          schema: z.object({
            fileId: z.string(),
            isLiked: z.boolean()
          }).strict()
        },
        'player:queue-update': {
          id: Symbol('player:queue-update'),
          schema: z.object({
            playlist: z.array(z.any()),
            index: z.number()
          }).strict()
        },
        'player:queue-visibility': {
          id: Symbol('player:queue-visibility'),
          schema: z.object({ isVisible: z.boolean() }).strict()
        },
        'player:time-update': {
          id: Symbol('player:time-update'),
          schema: z.object({ currentTime: z.number() }).strict()
        },
        'player:duration-change': {
          id: Symbol('player:duration-change'),
          schema: z.object({ duration: z.number() }).strict()
        },
        'player:volume-update': {
          id: Symbol('player:volume-update'),
          schema: z.object({
            volume: z.number(),
            isMuted: z.boolean()
          }).strict()
        },
        'audio:play': {
          id: Symbol('audio:play'),
          schema: z.object({
            file: z.any(),
            playlist: z.array(z.any()).optional(),
            index: z.number().optional()
          }).strict()
        },
        'call:ended': {
          id: Symbol('call:ended'),
          schema: z.object({
            call: z.any()
          }).strict()
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
        if (!eventDef.schema) throw new Error('Security Error: Missing Zod schema.')

        // Zod Validation Gate
        const validation = eventDef.schema.safeParse(detail)
        if (!validation.success) {
          console.warn('[Security] Dropped malformed payload.', validation.error.format())
          return
        }

        const callbacks = this.listeners.get(sym)
        if (callbacks) {
          callbacks.forEach(cb => cb(validation.data))
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
