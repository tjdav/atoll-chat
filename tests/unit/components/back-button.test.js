import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Back Button Component', () => {
  let tagName
  let emittedEvents

  beforeEach(async () => {
    document.body.innerHTML = ''
    emittedEvents = []

    const mockEventBus = {
      $bus: {
        emit: (event, payload) => {
          emittedEvents.push({ event, payload })
        },
        on: () => {}
      }
    }

    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    tagName = await loadComponent('atoll-back-button', {
      eventBus: mockEventBus
    })
  })

  test('should render inner atoll-button with correct default properties', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('data-testid', 'test-back-btn')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const button = el.querySelector('atoll-button')
    assert.ok(button, 'Inner atoll-button should exist')
    assert.equal(button.getAttribute('variant'), 'ghost')
    assert.equal(button.getAttribute('leading-icon'), 'chevron-left')
    assert.equal(button.getAttribute('icon-only'), 'true')
    assert.equal(button.getAttribute('data-testid'), 'test-back-btn')
  })

  test('should emit router:back event on click', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    el.click()

    await new Promise(resolve => setTimeout(resolve, 20))

    const backEmitted = emittedEvents.find(e => e.event === 'router:back')
    assert.ok(backEmitted, 'router:back should be emitted on click')
  })
})
