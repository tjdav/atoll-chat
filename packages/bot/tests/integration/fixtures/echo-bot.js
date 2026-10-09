import { defineBot } from '../../../src/define-bot.js'
import { defineCommand } from '../../../src/define-command.js'
import { defineSettings } from '../../../src/define-settings.js'
import { defineTrigger } from '../../../src/define-trigger.js'

/**
 * The fixture bot for the smoke test.
 *
 * Records every handler invocation to the exported `calls` object so
 * the smoke test can assert against it. Exports the same `defineBot`
 * handle the smoke test passes to `createTestRuntime`.
 *
 * The bot declares:
 * - one setting (greeting)
 * - one command (/ping with a count argument)
 * - one webhook trigger (/hook)
 * - one schedule trigger (every 5 minutes)
 * - install, uninstall, message, room, grantUpdated, and webhook and
 *   schedule handlers
 */
export const calls = {
  install: [],
  uninstall: [],
  message: [],
  room: [],
  grantUpdated: [],
  webhook: [],
  schedule: [],
  ping: []
}

export const bot = defineBot({
  id: 'com.example.echo',
  apiVersion: '1.0',
  hostApi: '1.0',
  label: 'Echo Bot',
  capabilities: ['post_message', 'read_commands'],
  settings: defineSettings({
    greeting: {
      label: 'Greeting',
      type: 'text'
    }
  }),
  commands: {
    ping: defineCommand({
      description: 'Reply with pong',
      args: {
        count: {
          type: 'number',
          required: false
        }
      },
      handler: async (ctx, args) => {
        const count = args.get('count') ?? 1
        calls.ping.push({ count })
        return {
          type: 'local_message',
          content: `pong x${count}`
        }
      }
    })
  },
  triggers: [
    defineTrigger({
      type: 'webhook',
      path: '/hook'
    }),
    defineTrigger({
      type: 'schedule',
      name: 'tick',
      cron: '*/5 * * * *',
      timezone: 'UTC'
    })
  ],
  handlers: {
    install: (ctx) => {
      calls.install.push({ roomId: ctx.room?.id ?? null })
    },
    uninstall: (ctx) => {
      calls.uninstall.push({ roomId: ctx.room?.id ?? null })
    },
    message: (ctx, event) => {
      calls.message.push({
        roomId: event.roomId,
        type: event.type,
        data: event.data
      })
    },
    room: (ctx, event) => {
      calls.room.push({
        roomId: event.roomId,
        type: event.type,
        data: event.data
      })
    },
    grantUpdated: (ctx, event) => {
      calls.grantUpdated.push({
        roomId: event.roomId,
        newMode: event.newMode
      })
    },
    webhook: (ctx, payload) => {
      calls.webhook.push({
        path: payload.path,
        body: payload.body
      })
    },
    schedule: (ctx, payload) => {
      calls.schedule.push({ name: payload.name })
    }
  }
})
