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

  it('5. Calling client.context(mockPluginContext) returns a function (or Promise resolving to phase 2 function)', async () => {
    const plugin = i18nPluginFactory({})
    const mockPluginContext = {}
    const instanceResolver = await plugin.client.context(mockPluginContext)
    assert.equal(typeof instanceResolver, 'function')
  })

  it('6. Calling the returned function with a mock instance context returns an object with t, getLocale, setLocale, subscribeLocale, strings keys', async () => {
    const plugin = i18nPluginFactory({})
    const mockPluginContext = {}
    const instanceResolver = await plugin.client.context(mockPluginContext)
    const clientCtx = instanceResolver({})
    assert.equal(typeof clientCtx.t, 'function')
    assert.equal(typeof clientCtx.getLocale, 'function')
    assert.equal(typeof clientCtx.setLocale, 'function')
    assert.equal(typeof clientCtx.subscribeLocale, 'function')
    assert.equal(typeof clientCtx.strings, 'function')
  })

  it('7. The t function returns the English value for a known key', async () => {
    const plugin = i18nPluginFactory({ defaultLocale: 'en' })
    const mockPluginContext = {}
    const instanceResolver = await plugin.client.context(mockPluginContext)
    const clientCtx = instanceResolver({})
    assert.equal(clientCtx.t('auth.login.title'), 'Log in')
  })

  it('8. The setLocale function changes the translation for a subsequent t call', async () => {
    const plugin = i18nPluginFactory({ defaultLocale: 'en' })
    const mockPluginContext = {}
    const instanceResolver = await plugin.client.context(mockPluginContext)
    const clientCtx = instanceResolver({})
    assert.equal(clientCtx.t('auth.login.title'), 'Log in')

    clientCtx.setLocale('fr')
    assert.equal(clientCtx.getLocale(), 'fr')
    assert.equal(clientCtx.t('auth.login.title'), 'Connexion')
  })

  it('9. Calling phase-2 resolver twice returns objects backed by the same underlying i18n instance', async () => {
    const plugin = i18nPluginFactory({ defaultLocale: 'en' })
    const mockPluginContext = {}
    const instanceResolver = await plugin.client.context(mockPluginContext)
    const ctx1 = instanceResolver({})
    const ctx2 = instanceResolver({})

    assert.equal(ctx1.getLocale(), 'en')
    assert.equal(ctx2.getLocale(), 'en')

    ctx1.setLocale('de')

    assert.equal(ctx1.getLocale(), 'de')
    assert.equal(ctx2.getLocale(), 'de')
    assert.equal(ctx2.t('auth.login.title'), 'Anmelden')
  })

  it('10. The strings helper maps key array to object dictionary on server and client context', async () => {
    const plugin = i18nPluginFactory({ defaultLocale: 'en' })
    const serverCtx = plugin.server.context({})({})
    const clientResolver = await plugin.client.context({})
    const clientCtx = clientResolver({})

    const keys = ['auth.login.title', 'auth.login.submit_button']
    const expected = {
      'auth.login.title': 'Log in',
      'auth.login.submit_button': 'Log in'
    }

    assert.deepEqual(serverCtx.strings(keys), expected)
    assert.deepEqual(clientCtx.strings(keys), expected)
  })

  it('11. subscribeLocale with signal unbinds automatically when AbortController aborts', async () => {
    const plugin = i18nPluginFactory({ defaultLocale: 'en' })
    const clientResolver = await plugin.client.context({})
    const clientCtx = clientResolver({})

    const controller = new AbortController()
    let calls = 0
    clientCtx.subscribeLocale(() => { calls++ }, { signal: controller.signal })

    clientCtx.setLocale('fr')
    assert.equal(calls, 1)

    controller.abort()

    clientCtx.setLocale('de')
    assert.equal(calls, 1)
  })
})
