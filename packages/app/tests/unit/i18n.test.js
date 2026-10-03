import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createI18n, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../../src/lib/i18n/index.js'

describe('createI18n factory', () => {
  const testLocales = {
    en: {
      'greeting': 'Hello',
      'welcome': 'Welcome, {name}!',
      'items': 'You have {count} items in {folder}.'
    },
    fr: {
      'greeting': 'Bonjour',
      'welcome': 'Bienvenue, {name} !'
    }
  }

  it('1. Basic translation from active locale', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'fr' })
    assert.equal(i18n.t('greeting'), 'Bonjour')
  })

  it('2. Fallback to default locale when key is missing in active locale', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'fr' })
    assert.equal(i18n.t('items', { count: 2, folder: 'Inbox' }), 'You have 2 items in Inbox.')
  })

  it('3. Missing key returns the key verbatim', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'en' })
    assert.equal(i18n.t('non.existent.key'), 'non.existent.key')
  })

  it('4. Variable substitution with a single token', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'en' })
    assert.equal(i18n.t('welcome', { name: 'Alice' }), 'Welcome, Alice!')
  })

  it('5. Multiple variables substituted', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'en' })
    assert.equal(i18n.t('items', { count: 5, folder: 'Archive' }), 'You have 5 items in Archive.')
  })

  it('6. Missing variable leaves the token intact', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'en' })
    assert.equal(i18n.t('welcome', {}), 'Welcome, {name}!')
  })

  it('7. Number variable coerced with String()', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'en' })
    assert.equal(i18n.t('items', { count: 42, folder: 'Trash' }), 'You have 42 items in Trash.')
  })

  it('8. setLocale changes the active locale; getLocale reflects it', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'en' })
    assert.equal(i18n.getLocale(), 'en')
    i18n.setLocale('fr')
    assert.equal(i18n.getLocale(), 'fr')
    assert.equal(i18n.t('greeting'), 'Bonjour')
  })

  it('9. setLocale with an unsupported locale is a silent no-op', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'en' })
    i18n.setLocale('es')
    assert.equal(i18n.getLocale(), 'en')
  })

  it('10. setLocale with the current locale is a silent no-op', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'en' })
    let called = 0
    i18n.subscribe(() => { called++ })
    i18n.setLocale('en')
    assert.equal(called, 0)
  })

  it('11. subscribe fires on locale change with the new locale code', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'en' })
    let received = null
    i18n.subscribe((loc) => { received = loc })
    i18n.setLocale('fr')
    assert.equal(received, 'fr')
  })

  it('12. subscribe returns an unsubscribe function; after unsubscribe, callback does not fire', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'en' })
    let count = 0
    const unsub = i18n.subscribe(() => { count++ })
    i18n.setLocale('fr')
    assert.equal(count, 1)
    unsub()
    i18n.setLocale('en')
    assert.equal(count, 1)
  })

  it('13. A throwing subscriber does not prevent other subscribers from firing', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'en' })
    let secondFired = false
    i18n.subscribe(() => { throw new Error('Subscriber error') })
    i18n.subscribe(() => { secondFired = true })

    const origQueueMicrotask = globalThis.queueMicrotask
    let queuedFn = null
    globalThis.queueMicrotask = (fn) => { queuedFn = fn }

    try {
      i18n.setLocale('fr')
      assert.equal(secondFired, true)
      assert.ok(queuedFn)
      assert.throws(() => queuedFn(), /Subscriber error/)
    } finally {
      globalThis.queueMicrotask = origQueueMicrotask
    }
  })

  it('14. createI18n throws on an unknown initialLocale', () => {
    assert.throws(() => {
      createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'invalid' })
    }, /not present in provided locales/)
  })

  it('15. availableLocales() returns the supported set', () => {
    const i18n = createI18n({ defaultLocale: 'en', locales: testLocales, initialLocale: 'en' })
    assert.deepEqual(i18n.availableLocales(), ['en', 'fr'])
    assert.deepEqual(SUPPORTED_LOCALES, ['en', 'fr', 'de', 'ja', 'pt', 'it', 'es'])
    assert.equal(DEFAULT_LOCALE, 'en')
  })

  it('16. Non-string key input is coerced', () => {
    const coercedLocales = {
      en: {
        '123': 'Number key 123',
        'null': 'Null key'
      }
    }
    const i18n = createI18n({ defaultLocale: 'en', locales: coercedLocales, initialLocale: 'en' })
    assert.equal(i18n.t(123), 'Number key 123')
    assert.equal(i18n.t(null), 'Null key')
  })
})
