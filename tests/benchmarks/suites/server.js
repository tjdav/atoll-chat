/**
 * @file Server hook & custom REST endpoints latency benchmarks suite.
 */

/**
 * Injects server endpoint helper methods into the browser-side `window.__perf` object.
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
     * Benchmarks latency of custom server endpoints.
     * @param {string} endpoint - The target API custom route endpoint.
     * @returns {Promise<number>} Resolves to the request latency in milliseconds.
     */
    window.__perf.benchServerHook = async function (endpoint) {
      const authRaw = window.localStorage.getItem('pocketbase_auth')
      const token = authRaw ? JSON.parse(authRaw).token : ''
      const start = performance.now()
      await window.fetch(`http://localhost:8091${endpoint}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-test-id': window.__playwright_test_id__ || 'default'
        }
      })
      return performance.now() - start
    }
  })
}

/**
 * Registers server hook benchmarks with the Mitata runner.
 * @param {import('@playwright/test').Page} _page - The Playwright Page instance (unused).
 * @param {Function} group - The Mitata group registration function.
 * @param {Function} bench - The Mitata bench registration function.
 * @returns {void}
 */
export function register (_page, group, bench) {
  group('Server hooks & governance (P1)', () => {
    bench('Admin overview latency (/api/custom/admin/overview)', async () => {
      await _page.evaluate(() => window.__perf.benchServerHook('/api/custom/admin/overview'))
    })
    bench('Owner public key latency (/api/custom/owner/public-key)', async () => {
      await _page.evaluate(() => window.__perf.benchServerHook('/api/custom/owner/public-key'))
    })
    bench('Invite generate latency (/api/custom/invites/generate)', async () => {
      await _page.evaluate(() => window.__perf.benchServerHook('/api/custom/invites/generate'))
    })
  })
}

/**
 * Runs any custom non-Mitata benchmarks. For server hooks, there are none.
 * @param {import('@playwright/test').Page} _page - The Playwright Page instance (unused).
 * @returns {Promise<Record<string, never>>} Resolves to an empty stats object.
 */
export async function runCustom (_page) {
  return {}
}

/**
 * Baseline threshold performance limits for server hook endpoints.
 * @type {Record<string, { p50?: number; min_p50?: number; msg: string }>}
 */
export const baselineLimits = {
  'Admin overview latency (/api/custom/admin/overview)': {
    p50: 150,
    msg: 'Admin overview REST API is too slow'
  }
}
