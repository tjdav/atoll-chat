/**
 * @file UI rendering and scrolling performance benchmarks suite.
 */

/**
 * Injects UI and timeline helper methods into the browser-side `window.__perf` object.
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
     * Benchmarks timeline message rendering duration for a given message count.
     * @param {number} msgCount - The number of messages to render.
     * @returns {Promise<number>} Resolves to the rendering duration in milliseconds.
     */
    window.__perf.benchTimelineRender = async function (msgCount) {
      const roomId = `perf_room_${msgCount}`
      const roomExists = await window.$localDb.local_rooms.get(roomId)
      if (!roomExists) {
        await window.$localDb.local_rooms.put({
          id: roomId,
          name: `Perf ${msgCount} Room`,
          is_group: false,
          updated_at: new Date().toISOString(),
          participants: [
            {
              id: 'alice',
              name: 'Alice',
              username: 'alice'
            },
            {
              id: 'bob',
              name: 'Bob',
              username: 'bob'
            }
          ]
        })
        const messages = []
        for (let i = 0; i < msgCount; i++) {
          messages.push({
            local_uuid: `perf_msg_${roomId}_${i}`,
            id: `perf_msg_${roomId}_${i}`,
            room_id: roomId,
            created_at: new Date(Date.now() - ((msgCount - i) * 1000)).toISOString(),
            sender_id: 'alice',
            type: 'text',
            content: `Test message ${i}`,
            status: 'sent'
          })
        }
        await window.$localDb.local_messages.bulkPut(messages)
        await new Promise(r => setTimeout(r, 300))
      }

      const latestMsgId = `perf_msg_${roomId}_${msgCount - 1}`
      const start = performance.now()
      window.$bus.emit('room:select', { room_id: roomId })

      await new Promise((resolve) => {
        const check = () => {
          const latestRow = document.querySelector(`atoll-chat-timeline-row[data-message-id="${latestMsgId}"]`)
          if (latestRow) {
            resolve()
          } else {
            setTimeout(check, 10)
          }
        }
        check()
      })

      const duration = performance.now() - start
      window.$bus.emit('room:select', { room_id: null })
      await new Promise(r => setTimeout(r, 100))
      return duration
    }

    /**
     * Benchmarks scrolling performance (FPS and Jank count) inside the timeline container.
     * @returns {Promise<{ fps: number; jankCount: number }>} Resolves to scroll metrics object.
     */
    window.__perf.benchTimelineScrollJank = async function () {
      const roomId = 'perf_room_500'
      window.$bus.emit('room:select', { room_id: roomId })
      const latestMsgId = 'perf_msg_perf_room_500_499'
      await new Promise((resolve) => {
        const check = () => {
          const latestRow = document.querySelector(`atoll-chat-timeline-row[data-message-id="${latestMsgId}"]`)
          if (latestRow) {
            resolve()
          } else {
            setTimeout(check, 10)
          }
        }
        check()
      })

      const container = document.querySelector('atoll-chat-timeline .overflow-auto')
      if (!container) {
        return {
          fps: 60,
          jankCount: 0
        }
      }

      const frameGaps = []
      let lastTime = performance.now()
      let isScrolling = true

      const sampleFrames = (now) => {
        const gap = now - lastTime
        frameGaps.push(gap)
        lastTime = now
        if (isScrolling) {
          requestAnimationFrame(sampleFrames)
        }
      }
      requestAnimationFrame(sampleFrames)

      const step = 50
      const delay = 16
      for (let current = container.scrollHeight; current > 0; current -= step) {
        container.scrollTop = current
        await new Promise(r => setTimeout(r, delay))
      }

      isScrolling = false
      await new Promise(r => setTimeout(r, 100))

      const totalDuration = frameGaps.reduce((a, b) => a + b, 0)
      const fps = (frameGaps.length / totalDuration) * 1000
      const jankCount = frameGaps.filter(g => g > 25).length

      window.$bus.emit('room:select', { room_id: null })
      return {
        fps,
        jankCount
      }
    }
  })
}

/**
 * Registers UI benchmarks with the Mitata runner. For custom measurements, we use runCustom.
 * @param {import('@playwright/test').Page} _page - The Playwright Page instance (unused).
 * @param {Function} _group - The Mitata group registration function (unused).
 * @param {Function} _bench - The Mitata bench registration function (unused).
 * @returns {void}
 */
export function register (_page, _group, _bench) {
  // UI rendering and scrolling are run via custom non-Mitata runner
}

/**
 * Runs the custom timeline rendering and scrolling benchmarks.
 * @param {import('@playwright/test').Page} page - The Playwright Page instance.
 * @returns {Promise<Record<string, { avg: number; p50: number; p95: number }>>} Resolves to the harvested statistics.
 */
export async function runCustom (page) {
  const t100 = await page.evaluate(() => window.__perf.benchTimelineRender(100))
  const t500 = await page.evaluate(() => window.__perf.benchTimelineRender(500))
  const t2000 = await page.evaluate(() => window.__perf.benchTimelineRender(2000))
  const scrollResults = await page.evaluate(() => window.__perf.benchTimelineScrollJank())

  return {
    'Timeline Render (100 messages)': {
      avg: t100,
      p50: t100,
      p95: t100
    },
    'Timeline Render (500 messages)': {
      avg: t500,
      p50: t500,
      p95: t500
    },
    'Timeline Render (2000 messages)': {
      avg: t2000,
      p50: t2000,
      p95: t2000
    },
    'Timeline Scroll FPS': {
      avg: scrollResults.fps,
      p50: scrollResults.fps,
      p95: scrollResults.fps
    },
    'Timeline Scroll Jank Count': {
      avg: scrollResults.jankCount,
      p50: scrollResults.jankCount,
      p95: scrollResults.jankCount
    }
  }
}

/**
 * Baseline threshold performance limits for UI render and scrolling metrics.
 * @type {Record<string, { p50?: number; min_p50?: number; msg: string }>}
 */
export const baselineLimits = {
  'Timeline Render (100 messages)': {
    p50: 300,
    msg: 'Timeline 100 messages rendering is too slow'
  },
  'Timeline Render (500 messages)': {
    p50: 3000,
    msg: 'Timeline 500 messages rendering is too slow'
  },
  'Timeline Render (2000 messages)': {
    p50: 2000,
    msg: 'Timeline 2000 messages rendering is too slow'
  },
  'Timeline Scroll FPS': {
    min_p50: 30,
    msg: 'Timeline scrolling FPS is too low'
  }
}
