// SPDX-License-Identifier: AGPL-3.0-or-later

const SCHEDULE_NAME = /^[a-z][a-z0-9-]*$/

/**
 * Returns the number of whitespace-separated fields in a cron
 * expression after trimming.
 * @param {string} cron - The cron expression.
 * @returns {number} The field count.
 */
function cronFieldCount (cron) {
  return cron.trim().split(/\s+/).length
}

/**
 * schedule-task registers a cron schedule with the runtime. On each
 * fire, it calls each child handler with the schedule name and fire
 * timestamp.
 *
 * This is the third composite trigger primitive. It follows the same
 * contract as watch-pattern and expose-command: create receives
 * resolved children, and the handler it returns invokes them with a
 * payload.
 * @type {Primitive}
 */
export const scheduleTask = {
  id: 'schedule-task',
  targets: ['bot'],
  capabilities: [],
  label: 'Schedule Task',
  description: 'Runs children on a cron schedule.',
  configSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, pattern: '^[a-z][a-z0-9-]*$' },
      cron: { type: 'string', minLength: 1 },
      timezone: { type: 'string' }
    },
    required: ['name', 'cron'],
    additionalProperties: false
  },
  create: (config, children) => {
    const name = config.name
    const cron = config.cron
    const timezone = config.timezone

    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('schedule-task: config.name is required')
    }
    if (!SCHEDULE_NAME.test(name)) {
      throw new Error(
        'schedule-task: config.name must match ^[a-z][a-z0-9-]*$'
      )
    }
    if (typeof cron !== 'string' || cron.length === 0) {
      throw new Error('schedule-task: config.cron is required')
    }
    const fields = cronFieldCount(cron)
    if (fields !== 5) {
      throw new Error(
        'schedule-task: config.cron must have exactly 5 fields, got ' + fields
      )
    }
    if (timezone !== undefined && typeof timezone !== 'string') {
      throw new Error('schedule-task: config.timezone must be a string')
    }
    if (!Array.isArray(children)) {
      throw new Error('schedule-task: children must be an array')
    }
    if (children.length === 0) {
      throw new Error('schedule-task: at least one child is required')
    }

    return async (ctx, input) => {
      const firedAt = input && typeof input === 'object' && typeof input.firedAt === 'string'
        ? input.firedAt
        : new Date().toISOString()
      const payload = { name, firedAt }
      for (const child of children) {
        await child(ctx, payload)
      }
    }
  }
}
