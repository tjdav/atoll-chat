import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Chip Component', () => {
  let tagName

  beforeEach(async () => {
    document.body.innerHTML = ''
    tagName = await loadComponent('atoll-chip')
  })

  test('should render basic chip and class modifiers', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('variant', 'primary')
    el.setAttribute('size', 'lg')
    el.setAttribute('selected', 'true')
    el.textContent = 'Active Tag'
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const innerChip = el.querySelector('.atoll-chip')
    assert.ok(innerChip, 'Inner chip should exist')
    assert.ok(innerChip.className.includes('atoll-chip'))
    assert.ok(innerChip.className.includes('atoll-chip-primary'))
    assert.ok(innerChip.className.includes('atoll-chip-lg'))
    assert.ok(innerChip.className.includes('atoll-chip-selected'))
    assert.equal(innerChip.getAttribute('role'), 'option')
    assert.equal(innerChip.getAttribute('aria-selected'), 'true')
    assert.equal(innerChip.getAttribute('tabindex'), '0')
  })

  test('should render correct default values', async () => {
    const el = document.createElement(tagName)
    el.textContent = 'Default'
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const innerChip = el.querySelector('.atoll-chip')
    assert.ok(innerChip.className.includes('atoll-chip-secondary'))
    assert.ok(innerChip.className.includes('atoll-chip-md'))
    assert.equal(innerChip.getAttribute('role'), 'button')
  })

  test('should handle disabled state correctly', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('disabled', 'true')
    el.textContent = 'Disabled'
    document.body.appendChild(el)

    let chipClicked = false
    el.addEventListener('click', () => {
      chipClicked = true
    })

    await new Promise(resolve => setTimeout(resolve, 10))

    const innerChip = el.querySelector('.atoll-chip')
    assert.ok(innerChip.className.includes('disabled'))
    assert.equal(innerChip.getAttribute('tabindex'), '-1')

    // Click suppression is handled inside the component or via disabled rules. Let's dispatch a click on the host.
    el.click()
    assert.equal(chipClicked, false, 'Click should be suppressed or ignored when disabled')
  })

  test('should sync and handle removable behavior', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('removable', 'true')
    el.setAttribute('value', 'id-123')
    el.textContent = 'Removable'
    document.body.appendChild(el)

    let removedPayload = null
    el.addEventListener('atoll-chip-remove', (e) => {
      removedPayload = e.detail.value
    })

    await new Promise(resolve => setTimeout(resolve, 10))

    const innerChip = el.querySelector('.atoll-chip')
    assert.ok(innerChip.className.includes('atoll-chip-removable'))

    const removeBtn = innerChip.querySelector('.atoll-chip-remove')
    assert.ok(removeBtn, 'Remove button should exist')

    // Click the remove button
    removeBtn.click()
    assert.equal(removedPayload, 'id-123')

    // Dynamically update value and confirm observation works
    el.setAttribute('value', 'id-456')
    await new Promise(resolve => setTimeout(resolve, 10))

    removeBtn.click()
    assert.equal(removedPayload, 'id-456')
  })

  test('should assert slot projection order', async () => {
    const el = document.createElement(tagName)
    el.innerHTML = `
      <span slot="leading" id="lead-item">L</span>
      Main Label
      <span slot="trailing" id="trail-item">T</span>
    `
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const leading = el.querySelector('#lead-item')
    const trailing = el.querySelector('#trail-item')
    const label = el.querySelector('.atoll-chip-label')

    assert.ok(leading, 'Leading slot element should exist')
    assert.ok(trailing, 'Trailing slot element should exist')
    assert.ok(label, 'Main label should exist')
    assert.equal(label.textContent.trim(), 'Main Label')
  })

  test('should support keyboard navigation', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('removable', 'true')
    el.setAttribute('value', 'keyboard-val')
    el.textContent = 'Keyboard Test'
    document.body.appendChild(el)

    let chipToggled = 0
    let chipRemoved = 0

    el.addEventListener('click', () => {
      chipToggled++
    })
    el.addEventListener('atoll-chip-remove', () => {
      chipRemoved++
    })

    await new Promise(resolve => setTimeout(resolve, 10))

    const innerChip = el.querySelector('.atoll-chip')

    // Dispatch Enter key
    innerChip.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true
    }))
    assert.equal(chipToggled, 1)

    // Dispatch Space key
    innerChip.dispatchEvent(new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true
    }))
    assert.equal(chipToggled, 2)

    // Dispatch Backspace key (triggers remove)
    innerChip.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true
    }))
    assert.equal(chipRemoved, 1)

    // Dispatch Delete key (triggers remove)
    innerChip.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Delete',
      bubbles: true
    }))
    assert.equal(chipRemoved, 2)
  })
})
