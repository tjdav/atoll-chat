/**
 * Coralite i18n Plugin
 *
 * Framework Architectural Contract & Usage Constraints:
 * 1. Plugin context (ctx.i18n) is delivered strictly to server() and client() blocks.
 *    It is NOT delivered to getters, style, or slots.
 * 2. Components bridge translations through state using i18n.strings(keys) in server()
 *    for SSR text and i18n.subscribeLocale(cb, { signal }) in client() for reactive updates.
 * 3. Phase 1 of client.context is async and runs ONCE per application at bootstrap.
 *    The client i18n singleton instance is instantiated in Phase 1 and closed over by Phase 2.
 * 4. The key list must be declared in both server() and client().
 *    This duplication is a known framework architectural cost.
 */

import { definePlugin } from 'coralite'
import { fileURLToPath } from 'node:url'
import { createI18n, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../lib/i18n/index.js'
import { locales } from '../lib/i18n/locales/index.js'

const STORAGE_KEY = 'atoll.preference.locale'

/**
 * Detects the initial locale at server/build time.
 *
 * @returns {string} The detected locale code.
 */
function detectInitialLocale() {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  try {
    const stored = window.localStorage?.getItem(STORAGE_KEY)
    if (stored && SUPPORTED_LOCALES.includes(stored)) return stored
  } catch { /* localStorage unavailable */ }
  const nav = typeof navigator !== 'undefined' ? navigator.language : null
  if (nav) {
    const short = nav.split('-')[0]
    if (SUPPORTED_LOCALES.includes(short)) return short
  }
  return DEFAULT_LOCALE
}

/**
 * Creates the Coralite i18n plugin instance.
 *
 * @param {Object} [options={}] Plugin options.
 * @param {string} [options.defaultLocale] Default fallback locale code.
 * @param {string} [options.initialLocale] Initial active locale code.
 * @returns {import('coralite').PluginDefinition} Coralite plugin object.
 */
export default (options = {}) => {
  const defaultLocale = options.defaultLocale ?? DEFAULT_LOCALE
  const initialLocale = options.initialLocale ?? detectInitialLocale()

  return definePlugin({
    name: 'i18n',
    rootDir: process.cwd(),
    filePath: fileURLToPath(import.meta.url),

    server: {
      context: (pluginContext) => (_instanceContext) => {
        const i18n = pluginContext.__i18n_server__ ??
          (pluginContext.__i18n_server__ = createI18n({
            defaultLocale,
            locales,
            initialLocale: defaultLocale
          }))
        return {
          t: (key, vars) => i18n.t(key, vars),
          getLocale: () => i18n.getLocale(),
          strings: (keys) => Object.fromEntries(keys.map(k => [k, i18n.t(k)]))
        }
      }
    },

    client: {
      // NOTE: Factory options (options.defaultLocale) are not currently threaded by Coralite to the client resolver.
      // Phase 1 runs once per app at bootstrap in the browser. It dynamically imports the library and creates the i18n singleton once.
      context: async (_pluginContext) => {
        const { createI18n, DEFAULT_LOCALE, SUPPORTED_LOCALES } = await import('../lib/i18n/index.js')
        const { locales } = await import('../lib/i18n/locales/index.js')

        const storageKey = 'atoll.preference.locale'
        let initialLoc = DEFAULT_LOCALE

        try {
          const stored = window.localStorage.getItem(storageKey)
          if (stored && SUPPORTED_LOCALES.includes(stored)) {
            initialLoc = stored
          }
        } catch {
          /* localStorage unavailable */
        }

        if (initialLoc === DEFAULT_LOCALE) {
          const nav = navigator.language
          if (nav) {
            const short = nav.split('-')[0]
            if (SUPPORTED_LOCALES.includes(short)) {
              initialLoc = short
            }
          }
        }

        const i18n = createI18n({
          defaultLocale: DEFAULT_LOCALE,
          locales,
          initialLocale: initialLoc
        })

        // Phase 2 runs per component instance and returns pure accessors closing over the phase-1 i18n singleton.
        return (_instanceContext) => ({
          t: (key, vars) => i18n.t(key, vars),
          getLocale: () => i18n.getLocale(),
          setLocale: (locale) => {
            i18n.setLocale(locale)
            try { window.localStorage.setItem(storageKey, locale) } catch { /* ignore */ }
          },
          subscribeLocale: (cb, { signal } = {}) => {
            const unsubscribe = i18n.subscribe(cb)
            signal?.addEventListener('abort', unsubscribe, { once: true })
            return unsubscribe
          },
          strings: (keys) => Object.fromEntries(keys.map(k => [k, i18n.t(k)]))
        })
      }
    }
  })
}
