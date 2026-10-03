import { definePlugin } from 'coralite'
import { fileURLToPath } from 'node:url'
import { createI18n, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../lib/i18n/index.js'
import { locales } from '../lib/i18n/locales/index.js'

const STORAGE_KEY = 'atoll.preference.locale'

/**
 * Detects the initial locale from localStorage or browser navigator.language.
 * Falls back to DEFAULT_LOCALE if unavailable or unrecognised.
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
          t: (key, vars) => i18n.t(key, vars)
        }
      }
    },

    client: {
      context: (pluginContext) => (_instanceContext) => {
        const i18n = pluginContext.__i18n_client__ ??
          (pluginContext.__i18n_client__ = createI18n({
            defaultLocale,
            locales,
            initialLocale
          }))
        return {
          t: (key, vars) => i18n.t(key, vars),
          getLocale: () => i18n.getLocale(),
          setLocale: (locale) => {
            i18n.setLocale(locale)
            try { window.localStorage?.setItem(STORAGE_KEY, locale) } catch { /* ignore */ }
          },
          subscribeLocale: (cb) => i18n.subscribe(cb)
        }
      }
    }
  })
}
