import {
  defineBot,
  defineCommand,
  defineCommands,
  defineSettings,
  defineTrigger
} from '@atoll/bot'

/**
 * Configure bot settings for customizable greetings and external secrets.
 */
const settings = defineSettings({
  greeting: {
    type: 'string',
    label: 'Greeting Message',
    description: 'Custom greeting prefix for incoming messages',
    default: 'Hello'
  },
  secretToken: {
    type: 'string',
    label: 'Secret Token',
    description: 'Secret token for external API access',
    secret: true
  }
})

/**
 * /ping command returning a local message response.
 */
const pingCommand = defineCommand({
  name: 'ping',
  description: 'Check bot responsiveness',
  args: [],
  async handler(_ctx) {
    return {
      type: 'local_message',
      message: 'pong'
    }
  }
})

/**
 * /roll command posting a die roll result directly to the room.
 */
const rollCommand = defineCommand({
  name: 'roll',
  description: 'Roll a die with an optional maximum value',
  args: [
    {
      name: 'max',
      type: 'number',
      description: 'Maximum roll value',
      required: false
    }
  ],
  async handler(ctx) {
    const max = ctx.args.max ?? 6
    const roll = Math.floor(Math.random() * max) + 1
    await ctx.post({
      text: `🎲 Rolled a ${roll} (1-${max})`
    })
    return { type: 'none' }
  }
})

/**
 * Webhook trigger configuration.
 */
const webhookTrigger = defineTrigger({
  type: 'webhook',
  name: 'example-hook',
  path: '/hooks/example',
  method: 'POST',
  secret: 'EXAMPLE_WEBHOOK_SECRET'
})

/**
 * Schedule trigger configuration (runs every hour on the hour).
 */
const scheduleTrigger = defineTrigger({
  type: 'schedule',
  name: 'hourly-heartbeat',
  expression: '0 * * * *',
  timezone: 'UTC'
})

/**
 * Echo Bot definition exposing settings, commands, triggers, and lifecycle handlers.
 */
export default defineBot({
  id: 'com.example.echo',
  label: 'Echo Bot Example',
  version: '1.0.0',
  mode: 'observer',
  capabilities: ['post_message'],
  hostApi: '1.0',
  settings,
  commands: defineCommands([pingCommand, rollCommand]),
  triggers: [webhookTrigger, scheduleTrigger],

  handlers: {
    /**
     * Called when the bot is installed.
     */
    async install(ctx) {
      ctx.log.info('Echo bot installed')
    },

    /**
     * Called when the bot is uninstalled or shut down.
     */
    async uninstall(ctx) {
      ctx.log.info('Echo bot uninstalled')
    },

    /**
     * Responds to incoming chat messages with the configured greeting.
     */
    async message(ctx) {
      if (!ctx.event.plaintext) return

      // Read configured greeting from settings store
      const greeting = (await ctx.settings.get('greeting')) ?? 'Hello'
      await ctx.reply({
        text: `${greeting}! You said: ${ctx.event.plaintext}`
      })
    },

    /**
     * Called when room grants are updated or revoked.
     */
    async grantUpdated(ctx) {
      ctx.log.info({ grant: ctx.grant }, 'Room grant updated')
    },

    /**
     * Called when a webhook endpoint receives a request.
     */
    async webhook(ctx) {
      ctx.log.info({ path: ctx.event.path }, 'Webhook event received')
    },

    /**
     * Called when a cron schedule fires.
     */
    async schedule(ctx) {
      ctx.log.info('Hourly heartbeat schedule triggered')
      const rooms = await ctx.rooms.list()
      for (const room of rooms) {
        await ctx.post({
          roomId: room.id,
          text: '💓 Hourly heartbeat check'
        })
      }
    }
  }
})
