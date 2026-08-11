/**
 * @file Database and persistence performance benchmarks suite.
 */

/**
 * Injects database helper methods into the browser-side `window.__perf` object.
 * @param {import('@playwright/test').Page} page - The Playwright Page instance.
 * @returns {Promise<void>} Resolves when the scripts are successfully injected.
 * @throws {Error} Throws if browser injection fails.
 */
export async function inject (page) {
  await page.evaluate(() => {
    if (!window.__perf) {
      window.__perf = {}
    }

    /**
     * Benchmarks IndexedDB (Dexie) write performance.
     * @returns {Promise<number>} Resolves to the write duration in milliseconds.
     */
    window.__perf.benchDbWrite = async function () {
      const roomId = 'perf_db_room'
      const messages = []
      for (let i = 0; i < 500; i++) {
        messages.push({
          local_uuid: `perf_db_msg_${i}`,
          id: `perf_db_msg_${i}`,
          room_id: roomId,
          created_at: new Date(Date.now() - (i * 1000)).toISOString(),
          sender_id: 'alice',
          type: 'text',
          content: `Perf message ${i}`,
          status: 'sent'
        })
      }
      const start = performance.now()
      await window.$localDb.local_messages.bulkPut(messages)
      const duration = performance.now() - start
      await window.$localDb.local_messages.where('room_id').equals(roomId).delete()
      return duration
    }

    /**
     * Benchmarks IndexedDB (Dexie) query performance.
     * @returns {Promise<number>} Resolves to the query duration in milliseconds.
     */
    window.__perf.benchDbQuery = async function () {
      const roomId = 'perf_db_query_room'
      const messages = []
      for (let i = 0; i < 200; i++) {
        messages.push({
          local_uuid: `perf_query_msg_${i}`,
          id: `perf_query_msg_${i}`,
          room_id: roomId,
          created_at: new Date(Date.now() - (i * 1000)).toISOString(),
          sender_id: 'alice',
          type: 'text',
          content: `Perf message ${i}`,
          status: 'sent'
        })
      }
      await window.$localDb.local_messages.bulkPut(messages)

      const start = performance.now()
      await window.$localDb.local_messages
        .where('[room_id+created_at]')
        .between([roomId, ''], [roomId, '\uffff'])
        .reverse()
        .limit(200)
        .toArray()
      const duration = performance.now() - start
      await window.$localDb.local_messages.where('room_id').equals(roomId).delete()
      return duration
    }
  })
}

/**
 * Registers database benchmarks with the Mitata runner.
 * @param {import('@playwright/test').Page} _page - The Playwright Page instance (unused).
 * @param {Function} group - The Mitata group registration function.
 * @param {Function} bench - The Mitata bench registration function.
 * @returns {void}
 */
export function register (_page, group, bench) {
  group('Database & persistence performance (P1)', () => {
    bench('Dexie write throughput (500 messages)', async () => {
      await _page.evaluate(() => window.__perf.benchDbWrite())
    })
    bench('Dexie query latency (200 messages)', async () => {
      await _page.evaluate(() => window.__perf.benchDbQuery())
    })
  })
}

/**
 * Runs any custom non-Mitata benchmarks. For database, there are none.
 * @param {import('@playwright/test').Page} _page - The Playwright Page instance (unused).
 * @returns {Promise<Record<string, never>>} Resolves to an empty stats object.
 */
export async function runCustom (_page) {
  return {}
}

/**
 * Baseline threshold performance limits for database operations.
 * @type {Record<string, { p50?: number; min_p50?: number; msg: string }>}
 */
export const baselineLimits = {
  'Dexie write throughput (500 messages)': {
    p50: 300,
    msg: 'IndexedDB bulk messages write is too slow'
  },
  'Dexie query latency (200 messages)': {
    p50: 200,
    msg: 'IndexedDB room messages query is too slow'
  }
}
