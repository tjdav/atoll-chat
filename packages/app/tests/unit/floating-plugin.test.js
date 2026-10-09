import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import floatingPluginFactory from '../../src/plugins/floating-plugin.js'

describe('floating-plugin Coralite integration', () => {
  it('1. The default export is a function', () => {
    assert.equal(typeof floatingPluginFactory, 'function')
  })

  it('2. Calling it returns an object with name === "floating"', () => {
    const plugin = floatingPluginFactory({})
    assert.equal(plugin.name, 'floating')
  })

  it('3. The returned plugin has server.context and client.context, both functions', () => {
    const plugin = floatingPluginFactory({})
    assert.equal(typeof plugin.server?.context, 'function')
    assert.equal(typeof plugin.client?.context, 'function')
  })

  it('4. server.context uses two-phase shape returning positionFloating and virtualElementFromPoint', () => {
    const plugin = floatingPluginFactory({})
    const instanceResolver = plugin.server.context({})
    assert.equal(typeof instanceResolver, 'function')
    const serverCtx = instanceResolver({})
    assert.equal(typeof serverCtx.positionFloating, 'function')
    assert.equal(typeof serverCtx.virtualElementFromPoint, 'function')
  })

  it('5. client.context is async, resolving to instance function returning positionFloating and virtualElementFromPoint functions', async () => {
    const plugin = floatingPluginFactory({})
    const instanceResolver = await plugin.client.context({})
    assert.equal(typeof instanceResolver, 'function')
    const clientCtx = instanceResolver({})
    assert.equal(typeof clientCtx.positionFloating, 'function')
    assert.equal(typeof clientCtx.virtualElementFromPoint, 'function')
  })

  it('6. serverContext.positionFloating() throws with a message naming SSR', () => {
    const plugin = floatingPluginFactory({})
    const serverCtx = plugin.server.context({})({})
    assert.throws(
      () => serverCtx.positionFloating(),
      /SSR/
    )
  })

  it('7. serverContext.virtualElementFromPoint() throws with a message naming SSR', () => {
    const plugin = floatingPluginFactory({})
    const serverCtx = plugin.server.context({})({})
    assert.throws(
      () => serverCtx.virtualElementFromPoint(),
      /SSR/
    )
  })

  it('8. virtualElementFromPoint(100, 200).getBoundingClientRect() returns correct rect', async () => {
    const plugin = floatingPluginFactory({})
    const instanceResolver = await plugin.client.context({})
    const clientCtx = instanceResolver({})
    const virtualEl = clientCtx.virtualElementFromPoint(100, 200)

    assert.deepEqual(virtualEl.getBoundingClientRect(), {
      x: 100,
      y: 200,
      top: 200,
      left: 100,
      right: 100,
      bottom: 200,
      width: 0,
      height: 0
    })
  })

  it('9. Two calls with different coordinates return independent objects', async () => {
    const plugin = floatingPluginFactory({})
    const instanceResolver = await plugin.client.context({})
    const clientCtx = instanceResolver({})

    const el1 = clientCtx.virtualElementFromPoint(10, 20)
    const el2 = clientCtx.virtualElementFromPoint(30, 40)

    assert.notStrictEqual(el1, el2)
    assert.equal(el1.getBoundingClientRect().x, 10)
    assert.equal(el2.getBoundingClientRect().x, 30)
  })

  it('10. The returned object is a plain object', async () => {
    const plugin = floatingPluginFactory({})
    const instanceResolver = await plugin.client.context({})
    const clientCtx = instanceResolver({})

    const virtualEl = clientCtx.virtualElementFromPoint(50, 60)
    assert.equal(Object.getPrototypeOf(virtualEl), Object.prototype)
  })

  it('11. Calling phase 2 instance resolver twice returns context objects sharing method references from Phase 1 closure', async () => {
    const plugin = floatingPluginFactory({})
    const mockPluginContext = {}

    const instanceResolver = await plugin.client.context(mockPluginContext)

    const ctx1 = instanceResolver({})
    const ctx2 = instanceResolver({})

    assert.strictEqual(ctx1.positionFloating, ctx2.positionFloating)
    assert.strictEqual(ctx1.virtualElementFromPoint, ctx2.virtualElementFromPoint)
  })
})
