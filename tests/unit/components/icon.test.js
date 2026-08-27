import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Icon Component', () => {
  let tagName

  beforeEach(async () => {
    document.body.innerHTML = ''
    tagName = await loadComponent('atoll-icon')
  })

  test('should render base icon class and resolved Solar SVG', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('name', 'music')
    el.setAttribute('size', 'lg')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const innerWrapper = el.querySelector('.atoll-icon')
    assert.ok(innerWrapper, 'Inner wrapper should exist')
    assert.ok(innerWrapper.className.includes('atoll-icon'))
    assert.ok(innerWrapper.className.includes('atoll-icon-lg'))

    const svg = innerWrapper.querySelector('svg.solar')
    assert.ok(svg, 'Solar SVG should be injected')
    assert.ok(svg.className.includes('solar-music'))
  })

  test('should support standard preset token and explicit numeric sizes on host element', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('name', 'search')
    el.setAttribute('size', '42')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const styleAttr = el.getAttribute('style') || ''
    assert.ok(/--atoll-icon-size:\s*42px/.test(styleAttr), 'Should apply explicit numeric size on custom element host')

    // Reactive attribute update
    el.setAttribute('size', 'xl')
    await new Promise(resolve => setTimeout(resolve, 10))

    const updatedStyleAttr = el.getAttribute('style') || ''
    assert.ok(/--atoll-icon-size:\s*48px/.test(updatedStyleAttr), 'Should reactively update preset size variable on host')
  })

  test('should support inline colors and secondary colors on host element', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('name', 'settings')
    el.setAttribute('color', '#ff0000')
    el.setAttribute('secondary-color', '#00ff00')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const styleAttr = el.getAttribute('style') || ''
    assert.ok(/--atoll-icon-primary-color:\s*#ff0000/.test(styleAttr), 'Should apply primary color variable on host')
    assert.ok(/--atoll-icon-secondary-color:\s*#00ff00/.test(styleAttr), 'Should apply secondary color variable on host')

    // Reactive color update
    el.setAttribute('color', '#0000ff')
    await new Promise(resolve => setTimeout(resolve, 10))

    const updatedStyleAttr = el.getAttribute('style') || ''
    assert.ok(/--atoll-icon-primary-color:\s*#0000ff/.test(updatedStyleAttr), 'Should reactively update primary color on host')
  })

  test('should handle accessibility and aria attributes correctly', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('name', 'logout')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    // Default: aria-hidden="true"
    assert.equal(el.getAttribute('aria-hidden'), 'true')
    assert.equal(el.hasAttribute('role'), false)
    assert.equal(el.hasAttribute('aria-label'), false)

    // Add aria-label
    el.setAttribute('aria-label', 'Logout of Application')
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.equal(el.getAttribute('role'), 'img')
    assert.equal(el.getAttribute('aria-label'), 'Logout of Application')
    assert.equal(el.hasAttribute('aria-hidden'), false)
  })
})
