import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import en from '../../src/lib/i18n/locales/en.js'
import fr from '../../src/lib/i18n/locales/fr.js'
import de from '../../src/lib/i18n/locales/de.js'
import ja from '../../src/lib/i18n/locales/ja.js'
import pt from '../../src/lib/i18n/locales/pt.js'
import itLocale from '../../src/lib/i18n/locales/it.js'
import es from '../../src/lib/i18n/locales/es.js'

describe('production i18n locales', () => {
  const allLocales = { en, fr, de, ja, pt, it: itLocale, es }
  const enKeys = Object.keys(en).sort()
  const ALLOWLIST = ['Face ID', 'ALTCHA', 'OPAQUE', 'Atoll', 'Extensions']

  it('1. Every locale exports the same key set as en', () => {
    assert.ok(enKeys.length > 0, 'en.js should have keys')
    for (const [code, dict] of Object.entries(allLocales)) {
      if (code === 'en') continue
      const keys = Object.keys(dict).sort()
      assert.deepEqual(keys, enKeys, `Locale ${code} key set does not match en.js`)
    }
  })

  it('2. No key has a blank value. "" and whitespace-only fail', () => {
    for (const [code, dict] of Object.entries(allLocales)) {
      for (const [key, value] of Object.entries(dict)) {
        assert.equal(typeof value, 'string', `Locale ${code} key ${key} is not a string`)
        assert.ok(value.trim().length > 0, `Locale ${code} key ${key} has blank or whitespace-only value`)
      }
    }
  })

  it('3. No non-English locale duplicates the English string, except for allowlist', () => {
    for (const [code, dict] of Object.entries(allLocales)) {
      if (code === 'en') continue
      for (const [key, value] of Object.entries(dict)) {
        const enValue = en[key]
        if (value === enValue) {
          const isAllowed = ALLOWLIST.some(term => value === term || value.includes(term))
          assert.ok(
            isAllowed,
            `Locale ${code} key "${key}" has value "${value}" identical to English without being in allowlist`
          )
        }
      }
    }
  })

  it('4. Every value is a string. No numbers, no null, no nested objects', () => {
    for (const [code, dict] of Object.entries(allLocales)) {
      for (const [key, value] of Object.entries(dict)) {
        assert.equal(typeof value, 'string', `Locale ${code} key ${key} value type is ${typeof value}, expected string`)
      }
    }
  })
})
