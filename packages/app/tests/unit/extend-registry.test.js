import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ExtensionRegistry, defineExtension } from '@atoll/extend'

describe('ExtensionRegistry unit tests', () => {
  function makeExt(id, route, railOrder = null) {
    const slug = id.split('.').pop()
    const ext = {
      id,
      apiVersion: '1.0.0',
      hostApi: '2.0.0',
      detail: {
        route,
        component: `x-${slug}-${route}-view`,
        title: route
      }
    }
    if (railOrder !== null) {
      ext.label = route
      ext.rail = {
        icon: { name: 'icon' },
        order: railOrder
      }
    }
    return defineExtension(ext)
  }

  test('1. add then get returns the same extension', () => {
    const registry = new ExtensionRegistry()
    const ext = makeExt('vendor.first', 'first')
    registry.add(ext)
    assert.equal(registry.get('vendor.first'), ext)
  })

  test('2. add a duplicate id throws', () => {
    const registry = new ExtensionRegistry()
    const ext1 = makeExt('vendor.duplicate', 'dup1')
    const ext2 = makeExt('vendor.duplicate', 'dup2')
    registry.add(ext1)
    assert.throws(() => {
      registry.add(ext2)
    }, /Extension with id 'vendor.duplicate' is already registered/)
  })

  test('3. has returns true for registered id, false otherwise', () => {
    const registry = new ExtensionRegistry()
    const ext = makeExt('vendor.exists', 'exists')
    registry.add(ext)
    assert.equal(registry.has('vendor.exists'), true)
    assert.equal(registry.has('vendor.missing'), false)
  })

  test('4. list returns extensions in registration order', () => {
    const registry = new ExtensionRegistry()
    const ext1 = makeExt('vendor.a', 'route-a')
    const ext2 = makeExt('vendor.b', 'route-b')
    const ext3 = makeExt('vendor.c', 'route-c')
    registry.add(ext1)
    registry.add(ext2)
    registry.add(ext3)
    const list = registry.list()
    assert.equal(list.length, 3)
    assert.equal(list[0], ext1)
    assert.equal(list[1], ext2)
    assert.equal(list[2], ext3)
  })

  test('5. byRailOrder returns only extensions with a rail, sorted by rail.order', () => {
    const registry = new ExtensionRegistry()
    const extNoRail = makeExt('vendor.norail', 'norail')
    const extRail20 = makeExt('vendor.r20', 'r20', 20)
    const extRail10 = makeExt('vendor.r10', 'r10', 10)
    const extRail30 = makeExt('vendor.r30', 'r30', 30)

    registry.add(extNoRail)
    registry.add(extRail20)
    registry.add(extRail10)
    registry.add(extRail30)

    const railList = registry.byRailOrder()
    assert.equal(railList.length, 3)
    assert.equal(railList[0], extRail10)
    assert.equal(railList[1], extRail20)
    assert.equal(railList[2], extRail30)
  })

  test('6. ownerOfRoute returns the extension whose detail.route matches', () => {
    const registry = new ExtensionRegistry()
    const extA = makeExt('vendor.exta', 'route-alpha')
    const extB = makeExt('vendor.extb', 'route-beta')
    registry.add(extA)
    registry.add(extB)

    assert.equal(registry.ownerOfRoute('route-alpha'), extA)
    assert.equal(registry.ownerOfRoute('route-beta'), extB)
  })

  test('7. ownerOfRoute returns undefined for an unknown route', () => {
    const registry = new ExtensionRegistry()
    const extA = makeExt('vendor.exta', 'route-alpha')
    registry.add(extA)
    assert.equal(registry.ownerOfRoute('unknown-route'), undefined)
  })

  test('8. size reflects the number of registrations', () => {
    const registry = new ExtensionRegistry()
    assert.equal(registry.size(), 0)
    registry.add(makeExt('vendor.one', 'one'))
    assert.equal(registry.size(), 1)
    registry.add(makeExt('vendor.two', 'two'))
    assert.equal(registry.size(), 2)
  })

  test('9. list and byRailOrder return frozen arrays', () => {
    const registry = new ExtensionRegistry()
    registry.add(makeExt('vendor.rail', 'rail', 1))
    assert.equal(Object.isFrozen(registry.list()), true)
    assert.equal(Object.isFrozen(registry.byRailOrder()), true)
  })
})
