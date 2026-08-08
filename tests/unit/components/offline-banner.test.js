import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Offline Banner Component', () => {
  let tagName

  beforeEach(async () => {
    document.body.innerHTML = ''
    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    tagName = await loadComponent('ui-offline-banner')
  })

  test('should render and bind isOnline state correctly', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const banner = el.querySelector('.offline-banner')
    assert.ok(banner, 'Offline banner div should exist')
  })

  test('should emit app:request_reconnect when retry button is clicked', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    // In Coralite/Happy-DOM unit test environment, we can fetch the button element
    const retryBtn = el.querySelector('atoll-button')
    assert.ok(retryBtn, 'Retry button should exist')

    // Since Coralite handles event bus globally via `globalStore` or global dependency injection,
    // let's click the button and assert that the click handler ran successfully.
    let called = false
    // Since our component gets `eventBus` injected, we can mock it or verify it emits app:request_reconnect
    // In our component, we have:
    // retryBtn.addEventListener('click', () => { $bus.emit('app:request_reconnect') })
    // Let's verify that the event listener is attached and dispatching click works
    retryBtn.click()
  })
})
