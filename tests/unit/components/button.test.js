import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Button Component', () => {
  let tagName

  beforeEach(async () => {
    // Ensure the body is clear
    document.body.innerHTML = ''
    tagName = await loadComponent('atoll-button')
  })

  test('should render base button with default attributes and slots', async () => {
    const el = document.createElement(tagName)
    el.textContent = 'Click Me'
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const button = el.querySelector('button')
    assert.ok(button, 'Inner button element should exist')
    assert.ok(button.className.includes('atoll-btn'), 'Should have atoll-btn base class')
    assert.ok(button.className.includes('atoll-btn-primary'), 'Should have atoll-btn-primary default variant class')
    assert.ok(button.className.includes('atoll-btn-md'), 'Should have atoll-btn-md default size class')

    const label = el.querySelector('.atoll-btn-label')
    assert.ok(label, 'Should wrap slot text in .atoll-btn-label container')
    assert.equal(label.textContent.trim(), 'Click Me')
  })

  test('should support variants, sizes, pill, block, and reactive attribute updates', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('variant', 'secondary')
    el.setAttribute('size', 'sm')
    el.setAttribute('pill', 'true')
    el.setAttribute('block', 'true')
    el.textContent = 'Styled Button'
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const button = el.querySelector('button')
    assert.ok(button.className.includes('atoll-btn-secondary'), 'Should have secondary variant class')
    assert.ok(button.className.includes('atoll-btn-sm'), 'Should have small size class')
    assert.ok(button.className.includes('atoll-btn-pill'), 'Should have pill shape class')
    assert.ok(button.className.includes('atoll-btn-block'), 'Should have block layout class')

    // Reactive attribute updates on live DOM node
    el.setAttribute('variant', 'danger')
    el.setAttribute('size', 'lg')
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.ok(button.className.includes('atoll-btn-danger'), 'Should reactively update to danger variant class')
    assert.ok(button.className.includes('atoll-btn-lg'), 'Should reactively update to large size class')
  })

  test('should propagate disabled attribute and block clicks in capture and bubble phases', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('disabled', 'true')
    el.textContent = 'Disabled Action'
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const button = el.querySelector('button')
    assert.ok(button.disabled, 'Inner native button should be disabled')

    let clicked = false
    el.addEventListener('click', () => {
      clicked = true
    })

    button.click()
    assert.equal(clicked, false, 'Click event should not propagate when button is disabled')

    // Click host element directly to ensure capturing-phase interception works
    let hostClicked = false
    el.addEventListener('click', () => {
      hostClicked = true
    })
    el.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    }))
    assert.equal(hostClicked, false, 'Click event on host element should be intercepted when disabled')
  })

  test('should support dynamic Bootstrap spinner loading state and variant', async () => {
    const el = document.createElement(tagName)
    el.textContent = 'Save'
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const button = el.querySelector('button')
    assert.equal(button.className.includes('atoll-btn-loading'), false, 'Should not have loading class initially')
    assert.ok(!button.querySelector('.atoll-btn-spinner'), 'Should not have spinner element initially')

    // Set loading
    el.setAttribute('loading', 'true')
    el.setAttribute('spinner-variant', 'light')
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.ok(button.className.includes('atoll-btn-loading'), 'Should have loading class when loading is true')
    assert.ok(button.disabled, 'Should be disabled when loading is true')

    const spinner = button.querySelector('.atoll-btn-spinner')
    assert.ok(spinner, 'Spinner wrapper should exist')

    const border = spinner.querySelector('.spinner-border')
    assert.ok(border, 'Spinner border should exist inside wrapper')
    assert.ok(border.className.includes('spinner-border-sm'), 'Should have small spinner border class')
    assert.ok(border.className.includes('text-light'), 'Should apply spinner variant class')
    assert.equal(border.getAttribute('role'), 'status')

    // Disable loading
    el.removeAttribute('loading')
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.equal(button.className.includes('atoll-btn-loading'), false, 'Should clean up loading class')
    assert.ok(!button.querySelector('.atoll-btn-spinner'), 'Should clean up spinner element')
    assert.ok(!button.disabled, 'Should re-enable button')
  })

  test('should support leadingIcon, trailingIcon, and text attributes programmatically', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('leading-icon', 'settings')
    el.setAttribute('trailing-icon', 'arrow-right')
    el.setAttribute('text', 'Attribute Text')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const leadingContainer = el.querySelector('.atoll-btn-leading')
    assert.ok(leadingContainer, 'Leading container should exist')
    const leadingIcon = leadingContainer.querySelector('atoll-icon')
    assert.ok(leadingIcon, 'Leading icon element should exist')
    assert.equal(leadingIcon.getAttribute('name'), 'settings')

    const trailingContainer = el.querySelector('.atoll-btn-trailing')
    assert.ok(trailingContainer, 'Trailing container should exist')
    const trailingIcon = trailingContainer.querySelector('atoll-icon')
    assert.ok(trailingIcon, 'Trailing icon element should exist')
    assert.equal(trailingIcon.getAttribute('name'), 'arrow-right')

    const label = el.querySelector('.atoll-btn-label')
    assert.ok(label, 'Label container should exist')
    assert.equal(label.textContent.trim(), 'Attribute Text')
  })
})
