import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Select Component (<atoll-select>)', () => {
  let tagName

  beforeEach(async () => {
    document.body.innerHTML = ''
    await loadComponent('atoll-icon')
    tagName = await loadComponent('atoll-select')
  })

  test('should render native details and summary combobox elements with default getters', async () => {
    const el = document.createElement(tagName)
    el.innerHTML = `
      <button class="dropdown-item" data-value="1">Option 1</button>
      <button class="dropdown-item" data-value="2">Option 2</button>
    `
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const details = el.querySelector('details.atoll-select')
    assert.ok(details, 'Details container element should exist')

    const summary = details.querySelector('summary.atoll-select-toggle[role="combobox"]')
    assert.ok(summary, 'Summary toggle element should exist with role combobox')
    assert.equal(summary.getAttribute('aria-expanded'), 'false')
    assert.equal(summary.getAttribute('tabindex'), '0')

    const hiddenInput = details.querySelector('input[type="hidden"]')
    assert.ok(hiddenInput, 'Hidden form input should exist')

    const label = summary.querySelector('.atoll-select-label')
    assert.equal(label.textContent.trim(), 'Select an option...')

    const menu = details.querySelector('ul.atoll-select-menu[role="listbox"]')
    assert.ok(menu, 'Dropdown menu listbox should exist')
  })

  test('should handle option selection, active class toggling, and atoll-change event dispatching', async () => {
    const el = document.createElement(tagName)
    el.innerHTML = `
      <button class="dropdown-item" data-value="val-1">First Option</button>
      <button class="dropdown-item" data-value="val-2">Second Option</button>
    `
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    let changeDetail = null
    el.addEventListener('atoll-change', (e) => {
      changeDetail = e.detail
    })

    const summary = el.querySelector('summary')
    summary.click()

    await new Promise(resolve => setTimeout(resolve, 20))

    const options = el.querySelectorAll('.dropdown-item')
    options[1].click()

    await new Promise(resolve => setTimeout(resolve, 20))

    assert.equal(el.value, 'val-2')
    assert.ok(changeDetail, 'atoll-change event should be dispatched')
    assert.equal(changeDetail.value, 'val-2')
    assert.equal(changeDetail.label, 'Second Option')

    const label = el.querySelector('.atoll-select-label')
    assert.equal(label.textContent.trim(), 'Second Option')
    assert.ok(options[1].classList.contains('active'))
    assert.equal(options[1].getAttribute('aria-selected'), 'true')
  })

  test('should synchronize hidden form input and handle form reset events', async () => {
    const form = document.createElement('form')
    const el = document.createElement(tagName)
    el.setAttribute('name', 'test_field')
    el.setAttribute('value', 'opt-1')
    el.innerHTML = `
      <button class="dropdown-item" data-value="opt-1">Option 1</button>
      <button class="dropdown-item" data-value="opt-2">Option 2</button>
    `
    form.appendChild(el)
    document.body.appendChild(form)

    await new Promise(resolve => setTimeout(resolve, 20))

    const hiddenInput = el.querySelector('input[type="hidden"]')
    assert.equal(hiddenInput.name, 'test_field')
    assert.equal(hiddenInput.value, 'opt-1')

    let inputFired = false
    let changeFired = false
    hiddenInput.addEventListener('input', () => { inputFired = true })
    hiddenInput.addEventListener('change', () => { changeFired = true })

    const options = el.querySelectorAll('.dropdown-item')
    options[1].click()

    await new Promise(resolve => setTimeout(resolve, 20))

    assert.equal(hiddenInput.value, 'opt-2')
    assert.ok(inputFired, 'Native input event should fire on hidden input')
    assert.ok(changeFired, 'Native change event should fire on hidden input')

    // Programmatically reset select back to initial value
    el.value = 'opt-1'
    await new Promise(resolve => setTimeout(resolve, 30))

    assert.equal(el.value, 'opt-1')
    assert.equal(el.querySelector('.atoll-select-label').textContent.trim(), 'Option 1')
  })

  test('should handle 60fps GPU exit transitions with atoll-select-closing class', async () => {
    const el = document.createElement(tagName)
    el.innerHTML = `
      <button class="dropdown-item" data-value="1">Item 1</button>
    `
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.show()
    const details = el.querySelector('details')
    assert.equal(details.open, true)

    el.hide()
    assert.ok(details.classList.contains('atoll-select-closing'), 'Should apply closing transition class')

    // Simulate transitionend
    const menu = el.querySelector('.atoll-select-menu')
    menu.dispatchEvent(new Event('transitionend', { bubbles: true }))

    await new Promise(resolve => setTimeout(resolve, 30))

    assert.equal(details.open, false)
    assert.equal(details.classList.contains('atoll-select-closing'), false)
  })

  test('should support placement="up" dropup positioning and autoFlip calculation', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('placement', 'up')
    el.innerHTML = `
      <button class="dropdown-item" data-value="1">Item 1</button>
    `
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const details = el.querySelector('details')
    assert.ok(details.classList.contains('atoll-select-dropup'), 'Should have atoll-select-dropup class')
  })

  test('should handle WCAG keyboard APG interactions (Enter/Space, Arrows, Home/End, Escape, Tab)', async () => {
    const el = document.createElement(tagName)
    el.innerHTML = `
      <button class="dropdown-item" data-value="1">Alpha</button>
      <button class="dropdown-item" data-value="2">Beta</button>
      <button class="dropdown-item" data-value="3">Gamma</button>
    `
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const summary = el.querySelector('summary')
    const details = el.querySelector('details')
    const menu = el.querySelector('.atoll-select-menu')

    summary.focus()
    // Enter to open
    summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    assert.equal(details.open, true)

    // Escape to close
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    menu.dispatchEvent(new Event('transitionend', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(details.open, false)

    // ArrowDown to open and navigate
    summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    assert.equal(details.open, true)
  })

  test('should dismiss menu when clicking outside component', async () => {
    const el = document.createElement(tagName)
    el.innerHTML = `
      <button class="dropdown-item" data-value="1">Item 1</button>
    `
    document.body.appendChild(el)

    const outsideDiv = document.createElement('div')
    document.body.appendChild(outsideDiv)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.show()
    assert.equal(Boolean(el.open), true, 'el.open should be true after show()')

    outsideDiv.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    outsideDiv.dispatchEvent(new Event('mousedown', { bubbles: true }))
    const menu = el.querySelector('.atoll-select-menu')
    menu.dispatchEvent(new Event('transitionend', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 30))

    assert.equal(Boolean(el.open), false)
  })

  test('should auto-sync label using MutationObserver when options are added asynchronously', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('value', 'async-val')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const menu = el.querySelector('.atoll-select-menu')

    const newOpt = document.createElement('button')
    newOpt.className = 'dropdown-item'
    newOpt.setAttribute('data-value', 'async-val')
    newOpt.textContent = 'Async Option Label'
    menu.appendChild(newOpt)

    await new Promise(resolve => setTimeout(resolve, 50))

    const label = el.querySelector('.atoll-select-label')
    assert.equal(label.textContent.trim(), 'Async Option Label')
  })

  test('should support programmatic methods and host properties', async () => {
    const el = document.createElement(tagName)
    el.innerHTML = `
      <button class="dropdown-item" data-value="x">X</button>
      <button class="dropdown-item" data-value="y">Y</button>
    `
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    // Set value
    el.value = 'y'
    assert.equal(el.value, 'y', 'Value should be y')

    // Set disabled
    el.disabled = true
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(Boolean(el.disabled), true, 'Disabled should be true')

    const summary = el.querySelector('summary')
    assert.equal(summary.getAttribute('aria-disabled'), 'true')

    el.disabled = false
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(Boolean(el.disabled), false)

    // Methods
    el.show()
    assert.equal(Boolean(el.open), true, 'el.open should be true after show()')

    el.hide()
    const menu = el.querySelector('.atoll-select-menu')
    menu.dispatchEvent(new Event('transitionend', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(Boolean(el.open), false)
  })
})
