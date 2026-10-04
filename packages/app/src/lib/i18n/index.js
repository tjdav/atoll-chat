import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './constants.js'

export { DEFAULT_LOCALE, SUPPORTED_LOCALES }

/**
 * @typedef {Record<string, string>} LocaleDictionary
 * @typedef {Record<string, LocaleDictionary>} LocalesMap
 * @typedef {Record<string, unknown>} TranslationVars
 */

/**
 * Creates an isolated i18n translation engine.
 *
 * @param {Object} options Options for i18n factory.
 * @param {string} [options.defaultLocale='en'] Fallback locale code.
 * @param {LocalesMap} [options.locales={}] Dictionary of supported locales.
 * @param {string} [options.initialLocale] Initial active locale code.
 * @returns {{
 *   t: (key: unknown, vars?: TranslationVars) => string,
 *   getLocale: () => string,
 *   setLocale: (locale: string) => void,
 *   subscribe: (cb: (locale: string) => void) => () => void,
 *   availableLocales: () => readonly string[]
 * }} The i18n engine interface.
 */
export function createI18n({ defaultLocale = DEFAULT_LOCALE, locales = {}, initialLocale } = {}) {
  if (initialLocale !== undefined && !(initialLocale in locales)) {
    throw new Error(`Initial locale "${initialLocale}" is not present in provided locales.`)
  }

  let activeLocale = initialLocale ?? defaultLocale
  /** @type {Set<(locale: string) => void>} */
  const subscribers = new Set()

  /**
   * Translates a key into the active or fallback locale string, substituting variables.
   *
   * @param {unknown} key Translation key string or coercible value.
   * @param {TranslationVars} [vars] Variable substitution map.
   * @returns {string} The resolved translation string.
   */
  function t(key, vars) {
    const keyStr = String(key)
    const activeDict = locales[activeLocale]
    const defaultDict = locales[defaultLocale]

    let template = keyStr
    if (activeDict && keyStr in activeDict) {
      template = String(activeDict[keyStr])
    } else if (defaultDict && keyStr in defaultDict) {
      template = String(defaultDict[keyStr])
    }

    if (vars && typeof vars === 'object') {
      return template.replace(/\{([^}]+)\}/g, (match, name) => {
        return name in vars ? String(vars[name]) : match
      })
    }

    return template
  }

  /**
   * Gets the active locale code.
   *
   * @returns {string} The active locale code.
   */
  function getLocale() {
    return activeLocale
  }

  /**
   * Sets the active locale code and notifies subscribers synchronously.
   *
   * @param {string} locale The new locale code to set.
   * @returns {void}
   */
  function setLocale(locale) {
    if (!(locale in locales)) {
      return
    }
    if (locale === activeLocale) {
      return
    }

    activeLocale = locale

    for (const callback of Array.from(subscribers)) {
      try {
        callback(activeLocale)
      } catch (err) {
        queueMicrotask(() => {
          throw err
        })
      }
    }
  }

  /**
   * Subscribes a listener callback to locale changes.
   *
   * @param {(locale: string) => void} cb Listener callback function.
   * @returns {() => void} Unsubscribe function.
   */
  function subscribe(cb) {
    if (typeof cb === 'function') {
      subscribers.add(cb)
    }
    return () => {
      subscribers.delete(cb)
    }
  }

  /**
   * Returns a frozen list of available locale codes in this instance.
   *
   * @returns {readonly string[]} Frozen array of available locale codes.
   */
  function availableLocales() {
    return Object.freeze(Object.keys(locales))
  }

  /**
   * Returns a key-value dictionary for an array of translation keys.
   *
   * @param {string[]} keys Array of translation key strings.
   * @returns {Record<string, string>} Object mapping each key to its resolved string.
   */
  function strings(keys) {
    if (!Array.isArray(keys)) {
      throw new TypeError('strings() requires an array of keys')
    }
    const out = {}
    for (const key of keys) {
      out[key] = t(key)
    }
    return out
  }

  return {
    t,
    getLocale,
    setLocale,
    subscribe,
    availableLocales,
    strings
  }
}
