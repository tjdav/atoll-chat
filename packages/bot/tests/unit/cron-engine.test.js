import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { IdempotencyStore } from '../../src/runtime/idempotency/index.js'
import { createCronEngine, nextFireTime, parseCron } from '../../src/runtime/triggers/cron.js'

/**
 * Controllable clock helper.
 *
 * @param {number} startMs - Initial timestamp.
 * @returns {{ now: () => number, advance: (ms: number) => void, onTick: (fn: (t: number) => void) => void }}
 */
function makeClock (startMs) {
  let current = startMs
  /** @type {((t: number) => void)[]} */
  const listeners = []
  return {
    now: () => current,
    advance (ms) {
      current += ms
      for (const l of [...listeners]) {
        l(current)
      }
    },
    onTick (fn) {
      listeners.push(fn)
    }
  }
}

/**
 * Controllable sleep helper.
 *
 * @param {ReturnType<typeof makeClock>} clock - Clock instance.
 * @returns {{ sleep: (ms: number) => Promise<void>, pending: { target: number, resolve: (value?: void) => void, done?: boolean }[] }}
 */
function makeSleep (clock) {
  /** @type {{ target: number, resolve: (value?: void) => void, done?: boolean }[]} */
  const pending = []
  /** @type {(ms: number) => Promise<void>} */
  const sleep = (ms) =>
    new Promise((resolve) => {
      const target = clock.now() + ms
      /** @type {{ target: number, resolve: (value?: void) => void, done?: boolean }} */
      const entry = { target, resolve }
      pending.push(entry)
      clock.onTick((t) => {
        if (t >= entry.target && !entry.done) {
          entry.done = true
          resolve()
        }
      })
    })
  return { sleep, pending }
}

/**
 * In-memory state store helper.
 *
 * @param {Record<string, unknown>} [initialState] - Initial key-values.
 * @returns {{ get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void>, setCalls: { key: string, value: unknown }[] }}
 */
/**
 * Simple in-memory storage for IdempotencyStore in tests.
 *
 * @returns {import('../../src/runtime/storage/index.js').Storage}
 */
function makeMemoryStorage () {
  /** @type {Map<string, unknown>} */
  const map = new Map()
  return /** @type {any} */ ({
    async get (/** @type {string} */ k) {
      return map.get(k)
    },
    async set (/** @type {string} */ k, /** @type {unknown} */ v) {
      map.set(k, v)
    },
    async delete (/** @type {string} */ k) {
      map.delete(k)
    },
    keys () {
      return Array.from(map.keys())
    }
  })
}

function makeStateStore (initialState = {}) {
  const map = new Map(Object.entries(initialState))
  /** @type {{ key: string, value: unknown }[]} */
  const setCalls = []
  return {
    /** @param {string} key */
    async get (key) {
      return map.get(key)
    },
    /**
     * @param {string} key
     * @param {unknown} value
     */
    async set (key, value) {
      setCalls.push({ key, value })
      map.set(key, value)
    },
    setCalls
  }
}

/**
 * Fake logger spy helper.
 *
 * @returns {import('../../src/runtime/diagnostics/logger.js').Logger & { logs: { level: string, msg: string, meta?: Record<string, unknown> }[] }}
 */
function makeLogger () {
  /** @type {{ level: string, msg: string, meta?: Record<string, unknown> }[]} */
  const logs = []
  return /** @type {any} */ ({
    logs,
    log (/** @type {string} */ level, /** @type {string} */ msg, /** @type {Record<string, unknown>} */ meta) {
      logs.push({ level, msg, ...(meta ? { meta } : {}) })
    },
    debug (/** @type {string} */ msg, /** @type {Record<string, unknown>} */ meta) {
      logs.push({ level: 'debug', msg, ...(meta ? { meta } : {}) })
    },
    info (/** @type {string} */ msg, /** @type {Record<string, unknown>} */ meta) {
      logs.push({ level: 'info', msg, ...(meta ? { meta } : {}) })
    },
    warn (/** @type {string} */ msg, /** @type {Record<string, unknown>} */ meta) {
      logs.push({ level: 'warn', msg, ...(meta ? { meta } : {}) })
    },
    error (/** @type {string} */ msg, /** @type {Record<string, unknown>} */ meta) {
      logs.push({ level: 'error', msg, ...(meta ? { meta } : {}) })
    },
    level () {
      return 'debug'
    }
  })
}

describe('Cron Engine Unit Tests', () => {
  describe('Parser Tests', () => {
    test('1. * * * * * parses to full sets', () => {
      const parsed = parseCron('* * * * *')
      assert.equal(parsed.minute.size, 60)
      assert.equal(parsed.hour.size, 24)
      assert.equal(parsed.dayOfMonth.size, 31)
      assert.equal(parsed.month.size, 12)
      assert.equal(parsed.dayOfWeek.size, 7)
      assert.equal(parsed.isDayOfMonthRestricted, false)
      assert.equal(parsed.isDayOfWeekRestricted, false)
    })

    test('2. 0 9 * * * matches minute 0, hour 9, all days', () => {
      const parsed = parseCron('0 9 * * *')
      assert.deepEqual(Array.from(parsed.minute), [0])
      assert.deepEqual(Array.from(parsed.hour), [9])
      assert.equal(parsed.dayOfMonth.size, 31)
      assert.equal(parsed.month.size, 12)
      assert.equal(parsed.dayOfWeek.size, 7)
    })

    test('3. 0 0 1 1 * matches midnight January 1st', () => {
      const parsed = parseCron('0 0 1 1 *')
      assert.deepEqual(Array.from(parsed.minute), [0])
      assert.deepEqual(Array.from(parsed.hour), [0])
      assert.deepEqual(Array.from(parsed.dayOfMonth), [1])
      assert.deepEqual(Array.from(parsed.month), [1])
      assert.equal(parsed.isDayOfMonthRestricted, true)
    })

    test('4. */15 * * * * matches 0, 15, 30, 45', () => {
      const parsed1 = parseCron('*/15 * * * *')
      assert.deepEqual(Array.from(parsed1.minute), [0, 15, 30, 45])

      const parsed2 = parseCron('0-59/15 * * * *')
      assert.deepEqual(Array.from(parsed2.minute), [0, 15, 30, 45])
    })

    test('5. 0 9-17 * * 1-5 matches weekdays 9-17', () => {
      const parsed = parseCron('0 9-17 * * 1-5')
      assert.deepEqual(Array.from(parsed.minute), [0])
      assert.deepEqual(Array.from(parsed.hour), [9, 10, 11, 12, 13, 14, 15, 16, 17])
      assert.deepEqual(Array.from(parsed.dayOfWeek), [1, 2, 3, 4, 5])
      assert.equal(parsed.isDayOfWeekRestricted, true)
    })

    test('6. 0,30 * * * * matches minutes 0 and 30', () => {
      const parsed = parseCron('0,30 * * * *')
      assert.deepEqual(Array.from(parsed.minute), [0, 30])
    })

    test('7. Day-of-week 7 normalizes to 0', () => {
      const parsed = parseCron('* * * * 7')
      assert.deepEqual(Array.from(parsed.dayOfWeek), [0])
    })

    test('8. Out-of-range minute (60) throws', () => {
      assert.throws(() => parseCron('60 * * * *'), /minute token '60' is out of range/)
    })

    test('9. Out-of-range hour (24) throws', () => {
      assert.throws(() => parseCron('0 24 * * *'), /hour token '24' is out of range/)
    })

    test('10. Malformed range (5-2) throws', () => {
      assert.throws(() => parseCron('5-2 * * * *'), /minute token '5-2' is out of range/)
    })

    test('11. Malformed step (*/0) throws', () => {
      assert.throws(() => parseCron('*/0 * * * *'), /minute step must be a positive integer/)
    })

    test('12. Non-numeric token (abc) throws', () => {
      assert.throws(() => parseCron('abc * * * *'), /minute token 'abc' is out of range/)
    })

    test('13. Six fields throw', () => {
      assert.throws(() => parseCron('* * * * * *'), /expected 5 fields, got 6/)
    })

    test('14. Four fields throw', () => {
      assert.throws(() => parseCron('* * * *'), /expected 5 fields, got 4/)
    })

    test('15. Non-string throws', () => {
      /** @type {any} */
      const invalid = 12345
      assert.throws(() => parseCron(invalid), /expression must be a string/)
    })
  })

  describe('nextFireTime Tests', () => {
    test('16. * * * * * from a known instant returns the next minute', () => {
      const cron = parseCron('* * * * *')
      const base = new Date('2025-01-01T10:15:30.000Z')
      const next = nextFireTime(cron, base, 'UTC')
      assert.equal(next.toISOString(), '2025-01-01T10:16:00.000Z')
    })

    test('17. 0 9 * * * from 08:30 returns 09:00 same day', () => {
      const cron = parseCron('0 9 * * *')
      const base = new Date('2025-01-01T08:30:00.000Z')
      const next = nextFireTime(cron, base, 'UTC')
      assert.equal(next.toISOString(), '2025-01-01T09:00:00.000Z')
    })

    test('18. 0 9 * * * from 09:30 returns 09:00 the next day', () => {
      const cron = parseCron('0 9 * * *')
      const base = new Date('2025-01-01T09:30:00.000Z')
      const next = nextFireTime(cron, base, 'UTC')
      assert.equal(next.toISOString(), '2025-01-02T09:00:00.000Z')
    })

    test('19. 0 0 1 1 * from Feb 1st returns Jan 1st of the next year', () => {
      const cron = parseCron('0 0 1 1 *')
      const base = new Date('2025-02-01T00:00:00.000Z')
      const next = nextFireTime(cron, base, 'UTC')
      assert.equal(next.toISOString(), '2026-01-01T00:00:00.000Z')
    })

    test('20. Day-of-month and day-of-week both restricted -> OR semantics', () => {
      // 0 0 13 * 5 matches 13th OR Friday
      const cron = parseCron('0 0 13 * 5')
      // 2025-06-01 is Sunday
      const base = new Date('2025-06-01T00:00:00.000Z')
      // Friday June 6th 2025
      const next1 = nextFireTime(cron, base, 'UTC')
      assert.equal(next1.toISOString(), '2025-06-06T00:00:00.000Z')

      // From Friday June 6th
      const next2 = nextFireTime(cron, next1, 'UTC')
      // Friday June 13th 2025
      assert.equal(next2.toISOString(), '2025-06-13T00:00:00.000Z')
    })

    test('21. Only day-of-month restricted -> matches only the 13th', () => {
      const cron = parseCron('0 0 13 * *')
      const base = new Date('2025-06-01T00:00:00.000Z')
      const next = nextFireTime(cron, base, 'UTC')
      assert.equal(next.toISOString(), '2025-06-13T00:00:00.000Z')
    })

    test('22. Only day-of-week restricted -> matches only Friday', () => {
      const cron = parseCron('0 0 * * 5')
      const base = new Date('2025-06-01T00:00:00.000Z')
      const next = nextFireTime(cron, base, 'UTC')
      assert.equal(next.toISOString(), '2025-06-06T00:00:00.000Z')
    })

    test('23. Both unrestricted -> matches every day', () => {
      const cron = parseCron('0 0 * * *')
      const base = new Date('2025-06-01T00:00:00.000Z')
      const next = nextFireTime(cron, base, 'UTC')
      assert.equal(next.toISOString(), '2025-06-02T00:00:00.000Z')
    })

    test('24. DST spring forward (skipped hour -> no fire)', () => {
      // In America/New_York, 2025-03-09 02:00-03:00 is skipped.
      const cron = parseCron('30 2 * * *')
      const base = new Date('2025-03-08T12:00:00.000Z')
      const next = nextFireTime(cron, base, 'America/New_York')
      // Should skip March 9th and fire on March 10th 02:30 EDT (06:30 UTC)
      assert.equal(next.toISOString(), '2025-03-10T06:30:00.000Z')
    })

    test('25. DST fall back (repeated hour -> fires once)', () => {
      // In America/New_York, 2025-11-02 01:00-02:00 repeats.
      const cron = parseCron('30 1 * * *')
      const base = new Date('2025-11-01T12:00:00.000Z')
      // First fire: 2025-11-02 01:30 EDT (05:30 UTC)
      const next1 = nextFireTime(cron, base, 'America/New_York')
      assert.equal(next1.toISOString(), '2025-11-02T05:30:00.000Z')

      // Next fire strictly after 05:30 UTC -> 2025-11-03 01:30 EST (06:30 UTC)
      const next2 = nextFireTime(cron, next1, 'America/New_York')
      assert.equal(next2.toISOString(), '2025-11-03T06:30:00.000Z')
    })

    test('26. Non-UTC timezone (Europe/Berlin)', () => {
      const cron = parseCron('0 9 * * *')
      // Winter: CET = UTC+1 -> 09:00 CET = 08:00 UTC
      const winterBase = new Date('2025-01-15T00:00:00.000Z')
      const winterNext = nextFireTime(cron, winterBase, 'Europe/Berlin')
      assert.equal(winterNext.toISOString(), '2025-01-15T08:00:00.000Z')

      // Summer: CEST = UTC+2 -> 09:00 CEST = 07:00 UTC
      const summerBase = new Date('2025-07-15T00:00:00.000Z')
      const summerNext = nextFireTime(cron, summerBase, 'Europe/Berlin')
      assert.equal(summerNext.toISOString(), '2025-07-15T07:00:00.000Z')
    })
  })

  describe('Engine Lifecycle & Schedule Execution Tests', () => {
    test('27. Zero schedule triggers -> start() is a no-op', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [],
        makeBotCtx: async () => (/** @type {any} */ ({})),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      await engine.start()
      await engine.stop()
    })

    test('28. start() computes the next fire for each valid trigger', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const logger = makeLogger()

      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [
          { type: 'schedule', name: 'hourly', cron: '0 * * * *' },
          { type: 'schedule', name: 'daily', cron: '0 12 * * *' }
        ],
        makeBotCtx: async () => (/** @type {any} */ ({})),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now,
        logger
      })

      await engine.start()

      const scheduledLogs = logger.logs.filter((l) => l.msg === 'cron trigger scheduled')
      assert.equal(scheduledLogs.length, 2)
      assert.equal(scheduledLogs[0]?.meta?.name, 'hourly')
      assert.equal(scheduledLogs[0]?.meta?.next_fire_at, '2025-01-01T01:00:00.000Z')
      assert.equal(scheduledLogs[1]?.meta?.name, 'daily')
      assert.equal(scheduledLogs[1]?.meta?.next_fire_at, '2025-01-01T12:00:00.000Z')

      await engine.stop()
    })

    test('29. Invalid cron is skipped and logged', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const logger = makeLogger()

      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [
          { type: 'schedule', name: 'bad', cron: 'bad expression' },
          { type: 'schedule', name: 'good', cron: '0 * * * *' }
        ],
        makeBotCtx: async () => (/** @type {any} */ ({})),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now,
        logger
      })

      await engine.start()

      const warnLogs = logger.logs.filter((l) => l.msg === 'skipped cron trigger due to invalid expression')
      assert.equal(warnLogs.length, 1)
      assert.equal(warnLogs[0]?.meta?.name, 'bad')

      const scheduledLogs = logger.logs.filter((l) => l.msg === 'cron trigger scheduled')
      assert.equal(scheduledLogs.length, 1)
      assert.equal(scheduledLogs[0]?.meta?.name, 'good')

      await engine.stop()
    })

    test('30. Invalid timezone is skipped and logged', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const logger = makeLogger()

      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [
          { type: 'schedule', name: 'bad_tz', cron: '0 * * * *', timezone: 'Invalid/Timezone' },
          { type: 'schedule', name: 'good_tz', cron: '0 * * * *' }
        ],
        makeBotCtx: async () => (/** @type {any} */ ({})),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now,
        logger
      })

      await engine.start()

      const warnLogs = logger.logs.filter((l) => l.msg === 'skipped cron trigger due to invalid timezone')
      assert.equal(warnLogs.length, 1)
      assert.equal(warnLogs[0]?.meta?.name, 'bad_tz')

      const scheduledLogs = logger.logs.filter((l) => l.msg === 'cron trigger scheduled')
      assert.equal(scheduledLogs.length, 1)

      await engine.stop()
    })

    test('31. A scheduled fire calls the handler', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)

      /** @type {any[]} */
      const dispatches = []
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async (inv) =>
          /** @type {any} */ ({
            schedule: async (/** @type {any} */ _ctx, /** @type {any} */ payload) => {
              dispatches.push({ inv, payload })
            }
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      await engine.start()

      // Advance 1 hour
      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))

      assert.equal(dispatches.length, 1)
      assert.equal(dispatches[0].payload.name, 'hourly')

      await engine.stop()
    })

    test('32. The invocation has name, scheduledAt, isCatchUp: false', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)

      /** @type {any[]} */
      const invocations = []
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async (inv) => {
          invocations.push(inv)
          return /** @type {any} */ ({ schedule: async () => {} })
        },
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      await engine.start()

      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))

      assert.equal(invocations.length, 1)
      assert.deepEqual(invocations[0], {
        name: 'hourly',
        scheduledAt: '2025-01-01T01:00:00.000Z',
        isCatchUp: false
      })

      await engine.stop()
    })

    test('33. Second fire at the next interval', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)

      let fireCount = 0
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => {
              fireCount++
            }
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      await engine.start()

      // First hour
      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(fireCount, 1)

      // Second hour
      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(fireCount, 2)

      await engine.stop()
    })

    test('34. Handler throw does not stop the schedule', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)

      let fireCount = 0
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => {
              fireCount++
              if (fireCount === 1) {
                throw new Error('handler exploded')
              }
            }
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      await engine.start()

      // First fire fails
      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(fireCount, 1)

      // Second fire succeeds
      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(fireCount, 2)

      await engine.stop()
    })

    test('35. Handler timeout (60 s) is enforced', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const logger = makeLogger()

      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'slow', cron: '0 * * * *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => {
              // Hang indefinitely
              await new Promise(() => {})
            }
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now,
        logger,
        handlerTimeoutMs: 10
      })

      await engine.start()

      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setTimeout(resolve, 20))

      // Check for error log
      const errLog = logger.logs.find((l) => l.msg === 'cron handler failed')
      assert.ok(errLog)
      assert.match(String(errLog?.meta?.error), /handler timed out after 10ms/)

      await engine.stop()
    })

    test('36. Duplicate dispatch suppressed by idempotency', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const idempotency = new IdempotencyStore({ storage: makeMemoryStorage() })

      // Pre-record key for 01:00:00
      await idempotency.record('hourly:2025-01-01T01:00:00.000Z')

      let fired = false
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => {
              fired = true
            }
          }),
        idempotency,
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      await engine.start()

      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))

      assert.equal(fired, false)

      await engine.stop()
    })

    test('37. last_fire persisted after success', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const stateStore = makeStateStore()

      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () => (/** @type {any} */ ({ schedule: async () => {} })),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore,
        sleep,
        now: clock.now
      })

      await engine.start()

      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))

      assert.equal(stateStore.setCalls.length, 1)
      assert.deepEqual(stateStore.setCalls[0], {
        key: '_runtime:cron:hourly:last_fire',
        value: '2025-01-01T01:00:00.000Z'
      })

      await engine.stop()
    })

    test('38. last_fire not persisted after failure', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const stateStore = makeStateStore()

      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => {
              throw new Error('boom')
            }
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore,
        sleep,
        now: clock.now
      })

      await engine.start()

      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))

      assert.equal(stateStore.setCalls.length, 0)

      await engine.stop()
    })
  })

  describe('Catch-Up Tests', () => {
    test('39. catchUp: false skips catch-up', async () => {
      const clock = makeClock(Date.parse('2025-01-01T05:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const stateStore = makeStateStore({
        '_runtime:cron:hourly:last_fire': '2025-01-01T01:00:00.000Z'
      })

      let dispatches = 0
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => {
              dispatches++
            }
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore,
        sleep,
        now: clock.now
      })

      await engine.start()
      assert.equal(dispatches, 0)

      await engine.stop()
    })

    test('40. catchUp: true with no prior fire skips catch-up', async () => {
      const clock = makeClock(Date.parse('2025-01-01T05:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const stateStore = makeStateStore()

      let dispatches = 0
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: true },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => {
              dispatches++
            }
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore,
        sleep,
        now: clock.now
      })

      await engine.start()
      assert.equal(dispatches, 0)

      await engine.stop()
    })

    test('41. catchUp: true with a prior fire dispatches missed windows', async () => {
      const clock = makeClock(Date.parse('2025-01-01T05:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const stateStore = makeStateStore({
        '_runtime:cron:hourly:last_fire': '2025-01-01T01:00:00.000Z'
      })

      /** @type {any[]} */
      const caughtUp = []
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: true },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async (inv) => {
          caughtUp.push(inv)
          return /** @type {any} */ ({ schedule: async () => {} })
        },
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore,
        sleep,
        now: clock.now
      })

      await engine.start()

      // Should catch up 02:00, 03:00, 04:00, 05:00
      assert.equal(caughtUp.length, 4)
      assert.equal(caughtUp[0].scheduledAt, '2025-01-01T02:00:00.000Z')
      assert.equal(caughtUp[0].isCatchUp, true)
      assert.equal(caughtUp[3].scheduledAt, '2025-01-01T05:00:00.000Z')
      assert.equal(caughtUp[3].isCatchUp, true)

      await engine.stop()
    })

    test('42. Catch-up overflow truncates to the most recent 100', async () => {
      // 200 missed minutes
      const startMs = Date.parse('2025-01-01T00:00:00.000Z')
      const nowMs = startMs + 200 * 60 * 1000
      const clock = makeClock(nowMs)
      const { sleep } = makeSleep(clock)
      const logger = makeLogger()
      const stateStore = makeStateStore({
        '_runtime:cron:minutely:last_fire': new Date(startMs).toISOString()
      })

      let dispatches = 0
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: true },
        triggers: [{ type: 'schedule', name: 'minutely', cron: '* * * * *' }],
        makeBotCtx: async () => {
          dispatches++
          return /** @type {any} */ ({ schedule: async () => {} })
        },
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore,
        sleep,
        now: clock.now,
        logger
      })

      await engine.start()

      assert.equal(dispatches, 100)

      const overflowLog = logger.logs.find((l) => l.msg === 'cron catch-up overflow')
      assert.ok(overflowLog)
      assert.equal(overflowLog?.meta?.missed_count, 200)
      assert.equal(overflowLog?.meta?.kept_count, 100)

      await engine.stop()
    })

    test('43. Catch-up dispatch updates last_fire', async () => {
      const clock = makeClock(Date.parse('2025-01-01T03:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const stateStore = makeStateStore({
        '_runtime:cron:hourly:last_fire': '2025-01-01T01:00:00.000Z'
      })

      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: true },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () => (/** @type {any} */ ({ schedule: async () => {} })),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore,
        sleep,
        now: clock.now
      })

      await engine.start()

      const lastSet = stateStore.setCalls[stateStore.setCalls.length - 1]
      assert.equal(lastSet?.value, '2025-01-01T03:00:00.000Z')

      await engine.stop()
    })

    test('44. Catch-up dispatch deduplicated by idempotency', async () => {
      const clock = makeClock(Date.parse('2025-01-01T03:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const idempotency = new IdempotencyStore({ storage: makeMemoryStorage() })
      const stateStore = makeStateStore({
        '_runtime:cron:hourly:last_fire': '2025-01-01T01:00:00.000Z'
      })

      // Pre-record 02:00:00
      await idempotency.record('hourly:2025-01-01T02:00:00.000Z')

      /** @type {string[]} */
      const ranIso = []
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: true },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async (inv) => {
          ranIso.push(inv.scheduledAt)
          return /** @type {any} */ ({ schedule: async () => {} })
        },
        idempotency,
        stateStore,
        sleep,
        now: clock.now
      })

      await engine.start()

      // Only 03:00:00 ran because 02:00:00 was in idempotency
      assert.deepEqual(ranIso, ['2025-01-01T03:00:00.000Z'])

      await engine.stop()
    })
  })

  describe('Stop & FireNow Tests', () => {
    test('45. stop() cancels pending sleeps', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)

      let fired = false
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => {
              fired = true
            }
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      await engine.start()
      await engine.stop()

      // Advance time past scheduled fire
      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))

      assert.equal(fired, false)
    })

    test('46. stop() waits for an in-flight handler', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)

      let handlerDone = false
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => {
              await new Promise((r) => setTimeout(r, 50))
              handlerDone = true
            }
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      await engine.start()

      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))

      const stopPromise = engine.stop()
      assert.equal(handlerDone, false)

      await stopPromise
      assert.equal(handlerDone, true)
    })

    test('47. stop() is idempotent', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)

      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () => (/** @type {any} */ ({})),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      await engine.start()
      await engine.stop()
      await engine.stop()
    })

    test('48. Restart after stop resumes scheduling', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)

      let dispatches = 0
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => {
              dispatches++
            }
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      await engine.start()
      await engine.stop()

      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(dispatches, 0)

      await engine.start()
      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(dispatches, 1)

      await engine.stop()
    })

    test('49. fireNow(name) dispatches immediately', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)

      /** @type {any[]} */
      const dispatches = []
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'manual_trigger', cron: '0 0 1 1 *' }],
        makeBotCtx: async (inv) =>
          /** @type {any} */ ({
            schedule: async (/** @type {any} */ _ctx, /** @type {any} */ payload) => {
              dispatches.push({ inv, payload })
            }
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      await engine.fireNow('manual_trigger')

      assert.equal(dispatches.length, 1)
      assert.equal(dispatches[0].inv.name, 'manual_trigger')
      assert.equal(dispatches[0].inv.isCatchUp, false)
      assert.equal(dispatches[0].payload.name, 'manual_trigger')
    })

    test('50. fireNow on an unknown name throws', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)

      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'manual_trigger', cron: '0 0 1 1 *' }],
        makeBotCtx: async () => (/** @type {any} */ ({})),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      await assert.rejects(() => engine.fireNow('non_existent'), /unknown schedule trigger 'non_existent'/)
    })

    test('51. fireNow does not use idempotency', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const idempotency = new IdempotencyStore({ storage: makeMemoryStorage() })

      // Record key matching now ISO
      await idempotency.record(`manual_trigger:${new Date(clock.now()).toISOString()}`)

      let fired = false
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'manual_trigger', cron: '0 0 1 1 *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => {
              fired = true
            }
          }),
        idempotency,
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      await engine.fireNow('manual_trigger')
      assert.equal(fired, true)
    })

    test('52. fireNow awaits the handler', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)

      let finished = false
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'slow_manual', cron: '0 0 1 1 *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => {
              await new Promise((r) => setTimeout(r, 20))
              finished = true
            }
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now
      })

      const firePromise = engine.fireNow('slow_manual')
      assert.equal(finished, false)

      await firePromise
      assert.equal(finished, true)
    })
  })

  describe('Pause Policy Tests', () => {
    test('57. Paused state skips fire and does not update last_fire', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)

      let fired = false
      const pausePolicy = {
        isPaused () { return true },
        async guard () { return { kind: 'paused' } },
        state () { return { paused: true, consecutive_failures: 3, first_failure_at: Date.now() } }
      }

      const stateStore = makeStateStore()
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () => (/** @type {any} */ ({ schedule: async () => { fired = true } })),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore,
        pausePolicy: /** @type {any} */ (pausePolicy),
        sleep,
        now: clock.now
      })

      await engine.start()

      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))

      assert.equal(fired, false)
      assert.equal(await stateStore.get('_runtime:cron:hourly:last_fire'), undefined)

      await engine.stop()
    })

    test('58. Handler throw increments the pause policy counter', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)

      const { createPausePolicy } = await import('../../src/runtime/pause-policy.js')
      const policy = createPausePolicy({
        reportPause: async () => {}
      })

      const stateStore = makeStateStore()
      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () => (/** @type {any} */ ({
          schedule: async () => {
            throw new Error('cron handler fail')
          }
        })),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore,
        pausePolicy: policy,
        sleep,
        now: clock.now
      })

      await engine.start()

      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))

      assert.equal(policy.state().consecutive_failures, 1)

      await engine.stop()
    })
  })

  describe('Logging Tests', () => {
    test('53. Logger emits debug on start and dispatch', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const logger = makeLogger()

      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'hourly', cron: '0 * * * *' }],
        makeBotCtx: async () => (/** @type {any} */ ({ schedule: async () => {} })),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now,
        logger
      })

      await engine.start()

      const startLog = logger.logs.find((l) => l.msg === 'cron engine start')
      assert.ok(startLog)
      assert.equal(startLog?.meta?.trigger_count, 1)

      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))

      const dispatchLog = logger.logs.find((l) => l.msg === 'cron dispatch success')
      assert.ok(dispatchLog)
      assert.equal(dispatchLog?.meta?.name, 'hourly')

      await engine.stop()
    })

    test('54. Logger emits warn on skipped trigger', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const logger = makeLogger()

      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'bad', cron: 'invalid' }],
        makeBotCtx: async () => (/** @type {any} */ ({})),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now,
        logger
      })

      await engine.start()

      const warnLog = logger.logs.find((l) => l.msg === 'skipped cron trigger due to invalid expression')
      assert.ok(warnLog)
      assert.equal(warnLog?.meta?.name, 'bad')

      await engine.stop()
    })

    test('55. Logger emits error on handler failure', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const logger = makeLogger()

      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'failing', cron: '0 * * * *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => {
              throw new Error('handler failed error')
            }
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now,
        logger
      })

      await engine.start()

      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))

      const errLog = logger.logs.find((l) => l.msg === 'cron handler failed')
      assert.ok(errLog)
      assert.equal(errLog?.meta?.name, 'failing')
      assert.equal(errLog?.meta?.error, 'handler failed error')

      await engine.stop()
    })

    test('56. Logger does not log the handler result', async () => {
      const clock = makeClock(Date.parse('2025-01-01T00:00:00.000Z'))
      const { sleep } = makeSleep(clock)
      const logger = makeLogger()

      const engine = createCronEngine({
        config: { timezone: 'UTC', catchUp: false },
        triggers: [{ type: 'schedule', name: 'secret_return', cron: '0 * * * *' }],
        makeBotCtx: async () =>
          /** @type {any} */ ({
            schedule: async () => ({ sensitive: 'classified' })
          }),
        idempotency: new IdempotencyStore({ storage: makeMemoryStorage() }),
        stateStore: makeStateStore(),
        sleep,
        now: clock.now,
        logger
      })

      await engine.start()

      clock.advance(3600 * 1000)
      await new Promise((resolve) => setImmediate(resolve))

      const allLogJson = JSON.stringify(logger.logs)
      assert.equal(allLogJson.includes('classified'), false)

      await engine.stop()
    })
  })
})
