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
        'app:logged-in': {
          id: Symbol('app:logged-in'),
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
