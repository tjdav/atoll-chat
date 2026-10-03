import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import i18nPluginFactory from '../../src/plugins/i18n-plugin.js'

describe('i18n-plugin Coralite integration', () => {
  it('1. The default export is a function. Calling it with {} returns an object with name === "i18n"', () => {
    assert.equal(typeof i18nPluginFactory, 'function')
    const plugin = i18nPluginFactory({})
    assert.equal(plugin.name, 'i18n')
  })

  it('2. Calling it with { defaultLocale: "en" } returns the same shape', () => {
    const plugin = i18nPluginFactory({ defaultLocale: 'en' })
    assert.equal(plugin.name, 'i18n')
  })

  it('3. The returned plugin object has a server key and a client key', () => {
    const plugin = i18nPluginFactory({})
    assert.ok(plugin.server)
    assert.ok(plugin.client)
    assert.equal(typeof plugin.server.context, 'function')
    assert.equal(typeof plugin.client.context, 'function')
  })

  it('4. The client.context is a function', () => {
    const plugin = i18nPluginFactory({})
    assert.equal(typeof plugin.client.context, 'function')
  })

  it('5. Calling client.context(mockPluginContext) returns a function', () => {
    const plugin = i18nPluginFactory({})
    const mockPluginContext = {}
    const instanceResolver = plugin.client.context(mockPluginContext)
    assert.equal(typeof instanceResolver, 'function')
  })

  it('6. Calling the returned function with a mock instance context returns an object with t, getLocale, setLocale, subscribeLocale keys', () => {
    const plugin = i18nPluginFactory({})
    const mockPluginContext = {}
    const instanceResolver = plugin.client.context(mockPluginContext)
    const clientCtx = instanceResolver({})
    assert.equal(typeof clientCtx.t, 'function')
    assert.equal(typeof clientCtx.getLocale, 'function')
    assert.equal(typeof clientCtx.setLocale, 'function')
    assert.equal(typeof clientCtx.subscribeLocale, 'function')
  })

  it('7. The t function returns the English value for a known key', () => {
    const plugin = i18nPluginFactory({ defaultLocale: 'en' })
    const mockPluginContext = {}
    const clientCtx = plugin.client.context(mockPluginContext)({})
    assert.equal(clientCtx.t('auth.login.title'), 'Log in')
  })

  it('8. The setLocale function changes the translation for a subsequent t call', () => {
    const plugin = i18nPluginFactory({ defaultLocale: 'en' })
    const mockPluginContext = {}
    const clientCtx = plugin.client.context(mockPluginContext)({})
    assert.equal(clientCtx.t('auth.login.title'), 'Log in')

    clientCtx.setLocale('fr')
    assert.equal(clientCtx.getLocale(), 'fr')
    assert.equal(clientCtx.t('auth.login.title'), 'Connexion')
  })

  it('9. Calling client.context twice with the same mockPluginContext returns objects backed by the same underlying i18n instance (singleton guard)', () => {
    const plugin = i18nPluginFactory({ defaultLocale: 'en' })
    const mockPluginContext = {}
    const ctx1 = plugin.client.context(mockPluginContext)({})
    const ctx2 = plugin.client.context(mockPluginContext)({})

    assert.equal(ctx1.getLocale(), 'en')
    assert.equal(ctx2.getLocale(), 'en')

    ctx1.setLocale('de')

    assert.equal(ctx1.getLocale(), 'de')
    assert.equal(ctx2.getLocale(), 'de')
    assert.equal(ctx2.t('auth.login.title'), 'Anmelden')
  })
})
