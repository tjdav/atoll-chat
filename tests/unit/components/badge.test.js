import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Badge Component', () => {
  let tagName

  beforeEach(async () => {
    // Ensure the body is clear
    document.body.innerHTML = ''
    tagName = await loadComponent('atoll-badge')
  })

  test('should render basic count and truncate correctly', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('count', '5')
    document.body.appendChild(el)

    // Wait for async rendering cycle
    await new Promise(resolve => setTimeout(resolve, 10))

    const innerBadge = el.querySelector('.atoll-badge')
    assert.ok(innerBadge, 'Inner badge element should exist')
    assert.equal(innerBadge.textContent.trim(), '5')
    assert.equal(el.getAttribute('role'), 'status')
    assert.equal(el.getAttribute('aria-label'), '5 unread messages')

    // Truncate logic
    el.setAttribute('count', '150')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(innerBadge.textContent.trim(), '99+')
    assert.equal(el.getAttribute('aria-label'), '99+ unread messages')

    // Test custom max-count
    el.setAttribute('max-count', '999')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(innerBadge.textContent.trim(), '150')
    assert.equal(el.getAttribute('aria-label'), '150 unread messages')
  })

  test('should support dot mode', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('dot', 'true')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const innerBadge = el.querySelector('.atoll-badge')
    assert.ok(innerBadge, 'Inner badge element should exist')
    assert.equal(innerBadge.textContent.trim(), '')
    assert.equal(el.getAttribute('role'), 'status')
    assert.equal(el.getAttribute('aria-label'), 'New notification')
    assert.ok(innerBadge.className.includes('atoll-badge-dot'))
  })

  test('should handle auto-hiding for zero or null counts', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('count', '0')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    // Should be hidden by default for 0
    assert.equal(el.getAttribute('hidden'), '')
    assert.equal(el.getAttribute('aria-hidden'), 'true')

    // Should show when show-zero is set
    el.setAttribute('show-zero', 'true')
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.equal(el.hasAttribute('hidden'), false)
    assert.equal(el.hasAttribute('aria-hidden'), false)

    // Should hide when count is removed
    el.removeAttribute('count')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(el.getAttribute('hidden'), '')
  })

  test('should support text/tag label mode, color variants, and size classes reactively', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('label', 'BOT')
    el.setAttribute('variant', 'secondary')
    el.setAttribute('size', 'sm')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const innerBadge = el.querySelector('.atoll-badge')
    assert.equal(innerBadge.textContent.trim(), 'BOT')
    assert.equal(el.getAttribute('role'), 'status')
    assert.equal(el.getAttribute('aria-label'), 'BOT')
    assert.ok(innerBadge.className.includes('atoll-badge-secondary'))
    assert.ok(innerBadge.className.includes('atoll-badge-sm'))

    // Reactive attribute mutation
    el.setAttribute('variant', 'info')
    el.setAttribute('size', 'lg')
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.ok(innerBadge.className.includes('atoll-badge-info'))
    assert.ok(innerBadge.className.includes('atoll-badge-lg'))
  })
})
