import { setTimeout as setTimeoutPromise } from 'node:timers/promises'

/** @type {number} */
const MAX_CATCH_UP_FIRES = 100
/** @type {number} */
const HANDLER_TIMEOUT_MS = 60000

/**
 * @typedef {object} ScheduleInvocation
 * @property {string} name - The trigger's name.
 * @property {string} scheduledAt - ISO 8601 of the intended fire time.
 * @property {boolean} isCatchUp - True when this is a catch-up fire.
 */

/**
 * @typedef {object} CronEngine
 * @property {() => Promise<void>} start - Parses triggers, runs catch-up (if enabled), and begins scheduling.
 * @property {() => Promise<void>} stop - Cancels all pending fires and waits for in-flight handlers to complete.
 * @property {(name: string) => Promise<void>} fireNow - Dispatches a named trigger immediately.
 */

/**
 * Parsed cron field sets.
 *
 * @typedef {object} ParsedCron
 * @property {Set<number>} minute - Minutes (0-59).
 * @property {Set<number>} hour - Hours (0-23).
 * @property {Set<number>} dayOfMonth - Days of month (1-31).
 * @property {Set<number>} month - Months (1-12).
 * @property {Set<number>} dayOfWeek - Days of week (0-6, Sunday = 0).
 * @property {boolean} isDayOfMonthRestricted - True if dayOfMonth is not full set (1-31).
 * @property {boolean} isDayOfWeekRestricted - True if dayOfWeek is not full set (0-6).
 */

/**
 * Parses a five-field cron expression into numeric set structures.
 *
 * @param {string} expression - Five-field cron expression string.
 * @returns {ParsedCron} - The parsed field sets.
 */
export function parseCron (expression) {
  if (typeof expression !== 'string') {
    throw new Error('cron: expression must be a string')
  }
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error(`cron: expected 5 fields, got ${fields.length}`)
  }

  const f0 = fields[0] ?? ''
  const f1 = fields[1] ?? ''
  const f2 = fields[2] ?? ''
  const f3 = fields[3] ?? ''
  const f4 = fields[4] ?? ''

  const minute = parseField(f0, 0, 59, 'minute')
  const hour = parseField(f1, 0, 23, 'hour')
  const dayOfMonth = parseField(f2, 1, 31, 'day-of-month')
  const month = parseField(f3, 1, 12, 'month')
  const dayOfWeek = parseField(f4, 0, 7, 'day-of-week', { normalizeDow: true })

  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    isDayOfMonthRestricted: dayOfMonth.size < 31,
    isDayOfWeekRestricted: dayOfWeek.size < 7
  }
}

/**
 * Parses a single cron field expression into a Set of numbers.
 *
 * @param {string} text - The field token.
 * @param {number} min - Minimum allowed value.
 * @param {number} max - Maximum allowed value.
 * @param {string} name - Field name for error messages.
 * @param {{ normalizeDow?: boolean }} [opts] - Field parsing options.
 * @returns {Set<number>} - Set of numbers.
 */
function parseField (text, min, max, name, opts = {}) {
  const set = new Set()
  for (const part of text.split(',')) {
    if (part.length === 0) {
      throw new Error(`cron: ${name} field has empty token`)
    }
    addPart(set, part, min, max, name, opts)
  }
  if (set.size === 0) {
    throw new Error(`cron: ${name} field is empty`)
  }
  return set
}

/**
 * Adds numbers from a single token (value, range, step) to the set.
 *
 * @param {Set<number>} set - Output set.
 * @param {string} part - Part string.
 * @param {number} min - Minimum allowed value.
 * @param {number} max - Maximum allowed value.
 * @param {string} name - Field name.
 * @param {{ normalizeDow?: boolean }} opts - Options.
 */
function addPart (set, part, min, max, name, opts) {
  let stepText = null
  const slashIdx = part.indexOf('/')
  if (slashIdx !== -1) {
    stepText = part.slice(slashIdx + 1)
    part = part.slice(0, slashIdx)
  }

  let step = 1
  if (stepText !== null) {
    step = Number(stepText)
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`cron: ${name} step must be a positive integer, got '${stepText}'`)
    }
  }

  let lo, hi
  if (part === '*') {
    lo = min
    hi = max
  } else if (part.includes('-')) {
    const rangeParts = part.split('-')
    if (rangeParts.length !== 2) {
      throw new Error(`cron: ${name} token '${part}' is malformed`)
    }
    lo = Number(rangeParts[0])
    hi = Number(rangeParts[1])
  } else {
    lo = Number(part)
    hi = lo
  }

  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
    throw new Error(`cron: ${name} token '${part}' is out of range or malformed`)
  }

  for (let v = lo; v <= hi; v += step) {
    const norm = opts.normalizeDow && v === 7 ? 0 : v
    set.add(norm)
  }
}

/**
 * Extract wall-clock local date components for a UTC millisecond timestamp in a timezone.
 *
 * @param {number} ms - UTC timestamp in milliseconds.
 * @param {string} timeZone - IANA timezone string.
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, second: number }}
 */
function getLocalParts (ms, timeZone) {
  const d = new Date(ms)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  })

  /** @type {Record<string, number>} */
  const parts = {}
  for (const p of dtf.formatToParts(d)) {
    if (p.type !== 'literal') {
      parts[p.type] = parseInt(p.value, 10)
    }
  }
  if (parts.hour === 24) {
    parts.hour = 0
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0
  }
}

/**
 * Creates a Date instance in UTC corresponding to wall-clock components in a timezone.
 * Returns null if the wall-clock time does not exist (e.g. DST spring-forward gap).
 *
 * @param {number} year - Year.
 * @param {number} month - Month (1-12).
 * @param {number} day - Day (1-31).
 * @param {number} hour - Hour (0-23).
 * @param {number} minute - Minute (0-59).
 * @param {number} second - Second (0-59).
 * @param {string} timeZone - IANA timezone identifier.
 * @returns {Date | null} - Date instance or null.
 */
function makeUtcDate (year, month, day, hour, minute, second, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const actualLocal = getLocalParts(utcGuess, timeZone)
  const actualAsUtc = Date.UTC(
    actualLocal.year,
    actualLocal.month - 1,
    actualLocal.day,
    actualLocal.hour,
    actualLocal.minute,
    actualLocal.second
  )
  const offsetMs = actualAsUtc - utcGuess
  const targetUtcMs = utcGuess - offsetMs

  const checkParts = getLocalParts(targetUtcMs, timeZone)
  if (
    checkParts.year === year &&
    checkParts.month === month &&
    checkParts.day === day &&
    checkParts.hour === hour &&
    checkParts.minute === minute &&
    checkParts.second === second
  ) {
    return new Date(targetUtcMs)
  }
  return null
}

/**
 * Computes the next fire time strictly after `afterDate` in the given timezone.
 *
 * @param {ParsedCron} cron - The parsed cron structure.
 * @param {Date} afterDate - Baseline date.
 * @param {string} timeZone - IANA timezone identifier.
 * @returns {Date} - The next fire time.
 */
export function nextFireTime (cron, afterDate, timeZone) {
  // Validate timezone
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
  } catch (_err) {
    throw new Error(`cron: invalid timezone '${timeZone}'`)
  }

  const startMs = afterDate.getTime()
  let { year, month, day, hour, minute } = getLocalParts(startMs, timeZone)

  // Advance by 1 minute strictly after
  minute += 1
  if (minute > 59) {
    minute = 0
    hour += 1
    if (hour > 23) {
      hour = 0
      day += 1
      // Handle month roll over dynamically in loop
    }
  }

  const maxYear = year + 5

  while (year <= maxYear) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    if (day > daysInMonth) {
      day = 1
      month += 1
      if (month > 12) {
        month = 1
        year += 1
        if (year > maxYear) {
          break
        }
      }
      continue
    }

    if (!cron.month.has(month)) {
      month += 1
      day = 1
      hour = 0
      minute = 0
      if (month > 12) {
        month = 1
        year += 1
      }
      continue
    }

    /* Check day matching: JS Date UTCDay is 0 = Sun, 1 = Mon, ... */
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay()

    let dayMatches = false
    if (!cron.isDayOfMonthRestricted && !cron.isDayOfWeekRestricted) {
      dayMatches = true
    } else if (cron.isDayOfMonthRestricted && !cron.isDayOfWeekRestricted) {
      dayMatches = cron.dayOfMonth.has(day)
    } else if (!cron.isDayOfMonthRestricted && cron.isDayOfWeekRestricted) {
      dayMatches = cron.dayOfWeek.has(dayOfWeek)
    } else {
      // Both restricted -> OR semantics
      dayMatches = cron.dayOfMonth.has(day) || cron.dayOfWeek.has(dayOfWeek)
    }

    if (!dayMatches) {
      day += 1
      hour = 0
      minute = 0
      continue
    }

    if (!cron.hour.has(hour)) {
      hour += 1
      minute = 0
      if (hour > 23) {
        hour = 0
        day += 1
      }
      continue
    }

    if (!cron.minute.has(minute)) {
      minute += 1
      if (minute > 59) {
        minute = 0
        hour += 1
        if (hour > 23) {
          hour = 0
          day += 1
        }
      }
      continue
    }

    // Attempt to construct UTC date
    const candDate = makeUtcDate(year, month, day, hour, minute, 0, timeZone)
    if (candDate && candDate.getTime() > startMs) {
      return candDate
    }

    // If construction failed (skipped DST hour) or resulted in <= startMs, advance minute
    minute += 1
    if (minute > 59) {
      minute = 0
      hour += 1
      if (hour > 23) {
        hour = 0
        day += 1
      }
    }
  }

  throw new Error('cron: expression cannot fire within 5 years')
}

/**
 * Default sleep implementation using setTimeout with ref: false.
 *
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>}
 */
function defaultSleep (ms) {
  return setTimeoutPromise(ms, undefined, { ref: false })
}

/**
 * Creates the cron engine.
 *
 * @param {object} deps - Factory dependencies.
 * @param {{ timezone: string, catchUp: boolean }} deps.config - Cron configuration block.
 * @param {ScheduleTrigger[]} deps.triggers - Trigger declarations.
 * @param {(invocation: ScheduleInvocation) => Promise<BotCtx>} deps.makeBotCtx - BotCtx constructor.
 * @param {import('../idempotency/index.js').IdempotencyStore} deps.idempotency - Idempotency store.
 * @param {{ get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void> }} deps.stateStore - State store.
 * @param {(ms: number) => Promise<void>} [deps.sleep=defaultSleep] - Sleep function.
 * @param {() => number} [deps.now=Date.now] - Clock function.
 * @param {import('../diagnostics/logger.js').Logger} [deps.logger] - Optional logger.
 * @param {number} [deps.handlerTimeoutMs] - Handler execution timeout in milliseconds.
 * @param {(ctx: BotCtx, payload: { name: string }) => Promise<void> | void} [deps.onSchedule] - Optional direct schedule handler.
 * @returns {CronEngine} - Engine instance.
 */
export function createCronEngine ({
  config,
  triggers,
  makeBotCtx,
  idempotency,
  stateStore,
  sleep = defaultSleep,
  now = Date.now,
  logger,
  handlerTimeoutMs = HANDLER_TIMEOUT_MS,
  onSchedule
}) {
  if (!config || typeof config !== 'object') {
    throw new Error('cron: config must be an object')
  }
  if (typeof config.timezone !== 'string') {
    throw new Error('cron: config.timezone must be a string')
  }
  if (typeof config.catchUp !== 'boolean') {
    throw new Error('cron: config.catchUp must be a boolean')
  }
  if (!Array.isArray(triggers)) {
    throw new Error('cron: triggers must be an array')
  }
  if (typeof makeBotCtx !== 'function') {
    throw new Error('cron: makeBotCtx must be a function')
  }
  if (!idempotency || typeof idempotency.checkAndRecord !== 'function' || typeof idempotency.remove !== 'function') {
    throw new Error('cron: idempotency store must provide checkAndRecord and remove methods')
  }
  if (!stateStore || typeof stateStore.get !== 'function' || typeof stateStore.set !== 'function') {
    throw new Error('cron: stateStore must provide get and set methods')
  }

  /** @type {ScheduleTrigger[]} */
  const scheduleTriggers = triggers.filter((t) => t && typeof t === 'object' && t.type === 'schedule')

  /** @type {Map<string, { cancel: () => void }>} */
  const pendingTasks = new Map()
  /** @type {Set<Promise<void>>} */
  const inFlightHandlers = new Set()

  let isStarted = false

  /**
   * Wraps a dispatch call with a timeout.
   *
   * @param {Promise<void>} promise - Handler promise.
   * @param {number} ms - Timeout in milliseconds.
   * @returns {Promise<void>}
   */
  function withTimeout (promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`cron: handler timed out after ${ms}ms`))
      }, ms)
      promise.then(
        (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        (e) => {
          clearTimeout(timer)
          reject(e)
        }
      )
    })
  }

  /**
   * Dispatches a single scheduled invocation.
   *
   * @param {ScheduleTrigger} trigger - Trigger declaration.
   * @param {string} scheduledAt - ISO string fire time.
   * @param {boolean} isCatchUp - Catch up flag.
   * @returns {Promise<void>}
   */
  async function dispatch (trigger, scheduledAt, isCatchUp) {
    const key = `${trigger.name}:${scheduledAt}`
    const seen = await idempotency.checkAndRecord(key)
    if (seen) {
      logger?.debug('cron idempotency hit', {
        name: trigger.name,
        scheduled_at: scheduledAt
      })
      return
    }

    /** @type {ScheduleInvocation} */
    const invocation = {
      name: trigger.name,
      scheduledAt,
      isCatchUp
    }

    let ctx
    try {
      ctx = await makeBotCtx(invocation)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger?.error('cron makeBotCtx failed', {
        name: trigger.name,
        error: errorMsg
      })
      return
    }

    /** @type {any} */
    const ctxUntyped = ctx
    const handlerFn = onSchedule ?? ctxUntyped.schedule ?? ctxUntyped.handlers?.schedule ?? ctxUntyped.config?.handlers?.schedule

    const startTime = now()
    const dispatchPromise = (async () => {
      try {
        if (typeof handlerFn === 'function') {
          await withTimeout(
            Promise.resolve().then(() => handlerFn(ctx, { name: trigger.name })),
            handlerTimeoutMs
          )
        }
        const durationMs = now() - startTime
        if (isCatchUp) {
          logger?.debug('cron catch-up dispatch success', {
            name: trigger.name,
            scheduled_at: scheduledAt,
            duration_ms: durationMs
          })
        } else {
          logger?.debug('cron dispatch success', {
            name: trigger.name,
            duration_ms: durationMs
          })
        }

        const stateKey = `_runtime:cron:${trigger.name}:last_fire`
        await stateStore.set(stateKey, scheduledAt)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger?.error('cron handler failed', {
          name: trigger.name,
          error: errorMsg
        })
      }
    })()

    inFlightHandlers.add(dispatchPromise)
    try {
      await dispatchPromise
    } finally {
      inFlightHandlers.delete(dispatchPromise)
    }
  }

  /**
   * Schedules the next fire for a trigger.
   *
   * @param {ScheduleTrigger} trigger - Trigger declaration.
   * @param {ParsedCron} parsedCron - Parsed cron.
   * @param {string} tz - Timezone.
   */
  function scheduleNext (trigger, parsedCron, tz) {
    if (!isStarted) {
      return
    }

    const currentNowMs = now()
    let nextMs
    try {
      nextMs = nextFireTime(parsedCron, new Date(currentNowMs), tz).getTime()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger?.warn('cron nextFireTime calculation failed', {
        name: trigger.name,
        error: errorMsg
      })
      return
    }

    const delayMs = Math.max(0, nextMs - currentNowMs)
    const scheduledAtIso = new Date(nextMs).toISOString()

    logger?.debug('cron trigger scheduled', {
      name: trigger.name,
      next_fire_at: scheduledAtIso
    })

    let isCancelled = false
    /** @type {((err: Error) => void) | null} */
    let timerReject = null

    /** @type {Promise<void>} */
    const sleepPromise = new Promise((resolve, reject) => {
      timerReject = reject
      sleep(delayMs).then(
        () => {
          if (!isCancelled) {
            resolve()
          }
        },
        (err) => {
          if (!isCancelled) {
            reject(err)
          }
        }
      )
    })

    const cancel = () => {
      isCancelled = true
      if (timerReject) {
        timerReject(new Error('cron task cancelled'))
      }
    }

    pendingTasks.set(trigger.name, { cancel })

    sleepPromise
      .then(async () => {
        pendingTasks.delete(trigger.name)
        if (!isStarted || isCancelled) {
          return
        }
        await dispatch(trigger, scheduledAtIso, false)
        // Schedule next recur
        scheduleNext(trigger, parsedCron, tz)
      })
      .catch(() => {
        pendingTasks.delete(trigger.name)
      })
  }

  return {
    async start () {
      if (isStarted) {
        return
      }
      isStarted = true

      logger?.debug('cron engine start', {
        trigger_count: scheduleTriggers.length
      })

      if (scheduleTriggers.length === 0) {
        return
      }

      for (const trigger of scheduleTriggers) {
        /** @type {ParsedCron} */
        let parsedCron
        try {
          parsedCron = parseCron(trigger.cron)
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger?.warn('skipped cron trigger due to invalid expression', {
            name: trigger.name,
            error: errorMsg
          })
          continue
        }

        const tz = trigger.timezone ?? config.timezone
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz })
        } catch (_err) {
          logger?.warn('skipped cron trigger due to invalid timezone', {
            name: trigger.name,
            timezone: tz
          })
          continue
        }

        // Catch up
        if (config.catchUp) {
          const stateKey = `_runtime:cron:${trigger.name}:last_fire`
          const lastFireVal = await stateStore.get(stateKey)
          if (typeof lastFireVal === 'string' && lastFireVal.length > 0) {
            const currentNowMs = now()
            const missedFires = []
            let cursor = new Date(lastFireVal)

            while (true) {
              let next
              try {
                next = nextFireTime(parsedCron, cursor, tz)
              } catch (_err) {
                break
              }
              if (next.getTime() > currentNowMs) {
                break
              }
              missedFires.push(next)
              cursor = next
            }

            if (missedFires.length > 0) {
              let firesToRun = missedFires
              if (missedFires.length > MAX_CATCH_UP_FIRES) {
                logger?.warn('cron catch-up overflow', {
                  name: trigger.name,
                  missed_count: missedFires.length,
                  kept_count: MAX_CATCH_UP_FIRES
                })
                firesToRun = missedFires.slice(-MAX_CATCH_UP_FIRES)
              }

              for (const missedDate of firesToRun) {
                if (!isStarted) {
                  break
                }
                const missedIso = missedDate.toISOString()
                await dispatch(trigger, missedIso, true)
              }
            }
          }
        }

        scheduleNext(trigger, parsedCron, tz)
      }
    },

    async stop () {
      if (!isStarted) {
        return
      }
      isStarted = false

      // Cancel all pending sleeps
      for (const task of pendingTasks.values()) {
        task.cancel()
      }
      pendingTasks.clear()

      // Wait for in-flight handlers
      await Promise.allSettled(Array.from(inFlightHandlers))
    },

    async fireNow (name) {
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('cron: name must be a non-empty string')
      }

      const trigger = scheduleTriggers.find((t) => t.name === name)
      if (!trigger) {
        throw new Error(`cron: unknown schedule trigger '${name}'`)
      }

      const scheduledAt = new Date(now()).toISOString()
      const invocation = {
        name: trigger.name,
        scheduledAt,
        isCatchUp: false
      }

      const ctx = await makeBotCtx(invocation)
      /** @type {any} */
      const ctxUntyped = ctx
      const handlerFn = onSchedule ?? ctxUntyped.schedule ?? ctxUntyped.handlers?.schedule ?? ctxUntyped.config?.handlers?.schedule

      if (typeof handlerFn === 'function') {
        await withTimeout(
          Promise.resolve().then(() => handlerFn(ctx, { name: trigger.name })),
          handlerTimeoutMs
        )
      }
    }
  }
}
