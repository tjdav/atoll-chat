import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Accordion Item Component Tests', () => {
  let tagName

  beforeEach(async () => {
    document.body.innerHTML = ''
    await loadComponent('atoll-icon')
    tagName = await loadComponent('atoll-accordion-item')
  })

  test('should instantiate atoll-accordion-item and render title', async () => {
    const element = document.createElement(tagName)
    element.setAttribute('title', 'Accordion Title')
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    const titleEl = element.querySelector('.atoll-accordion-item-title-text')
    assert.ok(titleEl, 'Title element should exist')
    assert.strictEqual(titleEl.textContent.trim(), 'Accordion Title')

    element.remove()
  })

  test('should render reactive slots for icon and badge dynamically', async () => {
    const element = document.createElement(tagName)
    element.setAttribute('title', 'Test Item')
    element.setAttribute('icon', 'settings')
    element.setAttribute('badge', '12')
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    const iconWrapper = element.querySelector('.atoll-accordion-item-icon-wrapper')
    assert.ok(iconWrapper, 'Icon wrapper slot node should be mounted when icon attribute is set')
    const icon = iconWrapper.querySelector('atoll-icon')
    assert.ok(icon, 'atoll-icon element should exist inside icon wrapper')
    assert.strictEqual(icon.getAttribute('name'), 'settings')

    const badgeEl = element.querySelector('.atoll-accordion-item-badge')
    assert.ok(badgeEl, 'Badge slot node should be mounted when badge attribute is set')
    assert.strictEqual(badgeEl.textContent.trim(), '12')

    // Update attributes to verify reactivity and unmounting (null return)
    element.removeAttribute('icon')
    element.removeAttribute('badge')
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.strictEqual(element.querySelector('.atoll-accordion-item-icon-wrapper'), null, 'Icon wrapper should be unmounted when icon attribute is removed')
    assert.strictEqual(element.querySelector('.atoll-accordion-item-badge'), null, 'Badge element should be unmounted when badge attribute is removed')

    element.remove()
  })
})
