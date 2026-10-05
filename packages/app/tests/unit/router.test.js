import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRouter } from '../../src/lib/router/index.js'

function makeWin(initialHref = 'http://localhost/app.html') {
  const listeners = { popstate: [] }
  let currentHref = initialHref
  return {
    location: {
      get href() { return currentHref }
    },
    history: {
      pushState(_state, _title, url) {
        currentHref = new URL(url, 'http://localhost').href
      },
      back() {}
    },
    addEventListener(type, cb) {
      if (listeners[type]) listeners[type].push(cb)
    },
    removeEventListener(type, cb) {
      if (listeners[type]) listeners[type] = listeners[type].filter((l) => l !== cb)
    },
    _setHref(href) { currentHref = href },
    _fire(type) { for (const cb of listeners[type] ?? []) cb() }
  }
}

describe('createRouter', () => {
  it('case 1: parse empty URL -> all nulls', () => {
    const win = makeWin('http://localhost/app.html')
    const router = createRouter({ win })
    assert.equal(router.getActiveRail(), null)
    assert.equal(router.getActiveDetail(), null)
    assert.equal(router.getSelection(), null)
    assert.deepEqual(router.getParams(), {})
  })

  it('case 2: parse ?rail=core.chat -> getActiveRail() === "core.chat"', () => {
    const win = makeWin('http://localhost/app.html?rail=core.chat')
    const router = createRouter({ win })
    assert.equal(router.getActiveRail(), 'core.chat')
    assert.equal(router.getActiveDetail(), null)
    assert.equal(router.getSelection(), null)
  })

  it('case 3: parse ?detail=chat&id=r_abc -> correct values', () => {
    const win = makeWin('http://localhost/app.html?detail=chat&id=r_abc')
    const router = createRouter({ win })
    assert.equal(router.getActiveRail(), null)
    assert.equal(router.getActiveDetail(), 'chat')
    assert.equal(router.getSelection(), 'r_abc')
  })

  it('case 4: getParams() returns all query parameters', () => {
    const win = makeWin('http://localhost/app.html?rail=core.chat&detail=chat&id=r_123&messageId=m_456')
    const router = createRouter({ win })
    assert.deepEqual(router.getParams(), {
      rail: 'core.chat',
      detail: 'chat',
      id: 'r_123',
      messageId: 'm_456'
    })
  })

  it('case 5: navigate({ rail: "core.media" }) calls pushState with URL containing ?rail=core.media', () => {
    const win = makeWin('http://localhost/app.html')
    const router = createRouter({ win })
    router.navigate({ rail: 'core.media' })
    assert.equal(win.location.href, 'http://localhost/app.html?rail=core.media')
    assert.equal(router.getActiveRail(), 'core.media')
  })

  it('case 6: navigate({ rail: "core.chat", detail: "chat", id: "r_1" }) writes all three', () => {
    const win = makeWin('http://localhost/app.html')
    const router = createRouter({ win })
    router.navigate({ rail: 'core.chat', detail: 'chat', id: 'r_1' })
    assert.equal(router.getActiveRail(), 'core.chat')
    assert.equal(router.getActiveDetail(), 'chat')
    assert.equal(router.getSelection(), 'r_1')
    assert.equal(win.location.href, 'http://localhost/app.html?rail=core.chat&detail=chat&id=r_1')
  })

  it('case 7: navigate({ rail: undefined, detail: "chat" }) omits rail', () => {
    const win = makeWin('http://localhost/app.html?rail=core.chat')
    const router = createRouter({ win })
    router.navigate({ rail: undefined, detail: 'chat' })
    assert.equal(router.getActiveRail(), null)
    assert.equal(router.getActiveDetail(), 'chat')
    assert.equal(win.location.href, 'http://localhost/app.html?detail=chat')
  })

  it('case 8: navigate fires subscribers synchronously', () => {
    const win = makeWin('http://localhost/app.html')
    const router = createRouter({ win })
    let fired = 0
    router.subscribe(() => {
      fired++
    })
    router.navigate({ rail: 'core.links' })
    assert.equal(fired, 1)
  })

  it('case 9: subscribe returns an unsubscribe function; after unsubscribe, callback does not fire', () => {
    const win = makeWin('http://localhost/app.html')
    const router = createRouter({ win })
    let fired = 0
    const unsubscribe = router.subscribe(() => {
      fired++
    })
    router.navigate({ rail: 'core.links' })
    assert.equal(fired, 1)
    unsubscribe()
    router.navigate({ rail: 'core.calls' })
    assert.equal(fired, 1)
  })

  it('case 10: a throwing subscriber does not prevent other subscribers', () => {
    const win = makeWin('http://localhost/app.html')
    const router = createRouter({ win })
    let fired2 = false
    router.subscribe(() => {
      throw new Error('Boom')
    })
    router.subscribe(() => {
      fired2 = true
    })
    router.navigate({ rail: 'core.settings' })
    assert.equal(fired2, true)
  })

  it('case 11: popstate fires subscribers', () => {
    const win = makeWin('http://localhost/app.html')
    const router = createRouter({ win })
    let fired = 0
    router.subscribe(() => {
      fired++
    })
    win._setHref('http://localhost/app.html?rail=core.settings')
    win._fire('popstate')
    assert.equal(fired, 1)
    assert.equal(router.getActiveRail(), 'core.settings')
  })

  it('case 12: dispose removes the popstate listener', () => {
    const win = makeWin('http://localhost/app.html')
    const router = createRouter({ win })
    let fired = 0
    router.subscribe(() => {
      fired++
    })
    router.dispose()
    win._setHref('http://localhost/app.html?rail=core.settings')
    win._fire('popstate')
    assert.equal(fired, 0)
  })
})
