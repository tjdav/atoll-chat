import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CANONICAL_ICONS, getIconModule, isIconName, listIcons } from '../../src/lib/icons/index.js'
import { SOLAR_MAP } from '../../src/lib/icons/solar-map.js'
import iconPlugin from '../../src/plugins/icon-plugin.js'

describe('Icon Registry & Map', () => {
  it('CANONICAL_ICONS is a frozen array containing the six expected names', () => {
    assert.strictEqual(Object.isFrozen(CANONICAL_ICONS), true)
    assert.deepStrictEqual(CANONICAL_ICONS, [
      'chat-round-line',
      'gallery',
      'document-text',
      'link',
      'phone',
      'settings'
    ])
  })

  it('isIconName correctly identifies canonical names', () => {
    assert.strictEqual(isIconName('chat-round-line'), true)
    assert.strictEqual(isIconName('gallery'), true)
    assert.strictEqual(isIconName('not-an-icon'), false)
  })

  it('getIconModule returns a non-empty string containing <svg for canonical names', () => {
    for (const name of CANONICAL_ICONS) {
      const svg = getIconModule(name)
      assert.strictEqual(typeof svg, 'string')
      assert.strictEqual(svg.includes('<svg'), true)
    }
  })

  it('getIconModule throws for non-canonical icon name', () => {
    assert.throws(
      () => getIconModule('not-an-icon'),
      /Unknown icon: not-an-icon/
    )
  })

  it('listIcons returns a frozen copy/reference of canonical icons', () => {
    const list = listIcons()
    assert.deepStrictEqual(list, CANONICAL_ICONS)
  })

  it('SOLAR_MAP has exact match with CANONICAL_ICONS keys', () => {
    const mapKeys = Object.keys(SOLAR_MAP).sort()
    const canonicalKeys = [...CANONICAL_ICONS].sort()
    assert.deepStrictEqual(mapKeys, canonicalKeys)

    for (const key of CANONICAL_ICONS) {
      assert.strictEqual(typeof SOLAR_MAP[key], 'string')
      assert.strictEqual(SOLAR_MAP[key].length > 0, true)
    }
  })
})

describe('Icon Plugin', () => {
  it('instantiates plugin with name icons and two-phase context factories', async () => {
    const plugin = iconPlugin()
    assert.strictEqual(plugin.name, 'icons')
    assert.strictEqual(typeof plugin.server.context, 'function')
    assert.strictEqual(typeof plugin.client.context, 'function')

    const serverResolver = plugin.server.context({})
    const serverCtx = serverResolver({})
    assert.strictEqual(typeof serverCtx.get, 'function')
    assert.strictEqual(typeof serverCtx.list, 'function')
    assert.strictEqual(typeof serverCtx.has, 'function')

    assert.strictEqual(serverCtx.has('chat-round-line'), true)
    assert.strictEqual(serverCtx.has('invalid'), false)
    assert.strictEqual(serverCtx.list().length, 6)
    assert.strictEqual(typeof serverCtx.get('chat-round-line'), 'string')

    const clientResolver = await plugin.client.context({})
    const clientCtx = clientResolver({})
    assert.strictEqual(typeof clientCtx.get, 'function')
    assert.strictEqual(clientCtx.has('gallery'), true)
  })
})
