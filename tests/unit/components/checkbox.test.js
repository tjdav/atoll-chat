import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Checkbox Component', () => {
  let tagName

  beforeEach(async () => {
    document.body.innerHTML = ''
    tagName = await loadComponent('atoll-checkbox')
  })

  test('should render checkbox with default attributes and states', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    assert.equal(el.getAttribute('role'), 'checkbox')
    assert.equal(el.getAttribute('aria-checked'), 'false')
    assert.equal(el.getAttribute('tabindex'), '0')

    const wrapper = el.querySelector('.atoll-checkbox')
    assert.ok(wrapper, 'Wrapper should exist')
    assert.equal(wrapper.className.includes('checked'), false)
    assert.equal(wrapper.className.includes('disabled'), false)

    const nativeInput = el.querySelector('input[type="checkbox"]')
    assert.ok(nativeInput, 'Native input should exist')
    assert.equal(nativeInput.checked, false)
    assert.equal(nativeInput.disabled, false)
    assert.equal(nativeInput.getAttribute('aria-label'), 'Toggle selection')

    const icon = el.querySelector('atoll-icon')
    assert.ok(icon, 'Icon should render')
    assert.equal(icon.getAttribute('name'), 'check')
    assert.equal(icon.getAttribute('size'), '22')
    assert.equal(icon.getAttribute('active'), 'false')
  })

  test('should support custom attribute overrides', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('size', '30')
    el.setAttribute('name', 'settings')
    el.setAttribute('label', 'Custom Setting Check')
    el.setAttribute('checked', 'true')
    el.setAttribute('disabled', 'true')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    assert.equal(el.getAttribute('aria-checked'), 'true')
    assert.equal(el.getAttribute('tabindex'), '-1')

    const wrapper = el.querySelector('.atoll-checkbox')
    assert.ok(wrapper.className.includes('checked'))
    assert.ok(wrapper.className.includes('disabled'))

    const nativeInput = el.querySelector('input[type="checkbox"]')
    assert.equal(nativeInput.checked, true)
    assert.equal(nativeInput.disabled, true)
    assert.equal(nativeInput.getAttribute('aria-label'), 'Custom Setting Check')

    const icon = el.querySelector('atoll-icon')
    assert.equal(icon.getAttribute('name'), 'settings')
    assert.equal(icon.getAttribute('size'), '30')
    assert.equal(icon.getAttribute('active'), 'true')
  })

  test('should support click interactions to toggle state and dispatch events', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    const events = []
    el.addEventListener('change', (e) => {
      events.push({
        type: 'change',
        checked: e.detail.checked
      })
    })
    el.addEventListener('input', (e) => {
      events.push({
        type: 'input',
        checked: e.detail.checked
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))

    const wrapper = el.querySelector('.atoll-checkbox')
    assert.equal(el.getAttribute('aria-checked'), 'false')

    // Simulate click on the wrapper
    wrapper.click()
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.equal(el.getAttribute('aria-checked'), 'true')
    assert.ok(wrapper.className.includes('checked'))

    assert.deepEqual(events.filter(e => e.type === 'change')[0], {
      type: 'change',
      checked: true
    })
    assert.deepEqual(events.filter(e => e.type === 'input')[0], {
      type: 'input',
      checked: true
    })

    // Simulate click again to toggle off
    wrapper.click()
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.equal(el.getAttribute('aria-checked'), 'false')
    assert.equal(wrapper.className.includes('checked'), false)
    assert.deepEqual(events.filter(e => e.type === 'change')[1], {
      type: 'change',
      checked: false
    })
  })

  test('should support keyboard interactions (Enter & Space)', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const wrapper = el.querySelector('.atoll-checkbox')

    // Keydown Space
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(el.getAttribute('aria-checked'), 'true')
    assert.ok(wrapper.className.includes('checked'))

    // Keydown Enter
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(el.getAttribute('aria-checked'), 'false')
    assert.equal(wrapper.className.includes('checked'), false)
  })

  test('should respect disabled status and block toggle interactions', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('disabled', 'true')
    document.body.appendChild(el)

    const events = []
    el.addEventListener('change', (e) => {
      events.push(e.detail.checked)
    })

    await new Promise(resolve => setTimeout(resolve, 10))

    const wrapper = el.querySelector('.atoll-checkbox')
    assert.equal(el.getAttribute('tabindex'), '-1')
    assert.ok(wrapper.className.includes('disabled'))

    // Click should be ignored
    wrapper.click()
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.equal(el.getAttribute('aria-checked'), 'false')
    assert.equal(events.length, 0)
  })

  test('should support programmatic getters and setters on the element instance', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    // Set programmatic checked state
    el.checked = true
    assert.equal(el.checked, true)
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(el.getAttribute('aria-checked'), 'true')

    el.checked = false
    assert.equal(el.checked, false)
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(el.getAttribute('aria-checked'), 'false')

    // Set programmatic disabled state
    el.disabled = true
    assert.equal(el.disabled, true)
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(el.getAttribute('tabindex'), '-1')

    el.disabled = false
    assert.equal(el.disabled, false)
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(el.getAttribute('tabindex'), '0')
  })

  test('should support attribute observation changes reactively', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const wrapper = el.querySelector('.atoll-checkbox')

    // Set 'checked' attribute
    el.setAttribute('checked', 'true')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(el.getAttribute('aria-checked'), 'true')
    assert.ok(wrapper.className.includes('checked'))

    // Remove 'checked' attribute
    el.removeAttribute('checked')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(el.getAttribute('aria-checked'), 'false')
    assert.equal(wrapper.className.includes('checked'), false)
  })
})
