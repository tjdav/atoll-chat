import { createPlugin } from 'coralite'
import { z } from 'zod'


export default createPlugin({
  name: 'event-bus-plugin',
  client: {
    imports: [
      {
        specifier: 'zod',
        namedExports: ['z']
      }
    ],
    setup (context) {
      const z = context.imports.z
      // Define the secure events and their schemas privately inside the module
      const ChatEvents = {
        APP_LOGGED_IN: {
          id: Symbol('app:logged-in'),
          schema: z.object({}).strict().optional()
        },
        CHAT_ROOM_SELECTED: {
          id: Symbol('chat:room-selected'),
          schema: z.object({
            roomId: z.string().min(1)
          })
        },
        CHAT_ROOM_READY: {
          id: Symbol('chat:room-ready'),
          schema: z.object({
            roomId: z.string().min(1)
          })
        },
        CHAT_MESSAGE_SUBMITTED: {
          id: Symbol('chat:message-submitted'),
          schema: z.object({
            text: z.string()
          })
        },
        CHAT_MESSAGE_SENT: {
          id: Symbol('chat:message-sent'),
          schema: z.object({}).strict().optional()
        },
        CHAT_MESSAGE_RECEIVED: {
          id: Symbol('chat:message-received'),
          schema: z.object({
            text: z.string(),
            encrypted: z.boolean().default(true)
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
      events: (context) => (id) => context.values.ChatEvents[id],

      emit: (context) => (eventDef, detail) => {
        context.values.globalBroker.emit(eventDef, detail)
      },
      on: (context) => (eventDef, callback) => {
        return context.values.globalBroker.on(eventDef, callback)
      }
    }
  }
})
