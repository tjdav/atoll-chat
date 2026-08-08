import { test, describe, beforeEach, before } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Chat Timeline Row Component', () => {
  let tagName

  before(() => {
    // Define a dummy custom element for atoll-chat-message-reactions to prevent loading errors
    if (!customElements.get('atoll-chat-message-reactions')) {
      customElements.define('atoll-chat-message-reactions', class extends HTMLElement {
        connectedCallback () {
        }
      })
    }
  })

  beforeEach(async () => {
    document.body.innerHTML = ''
    tagName = await loadComponent('atoll-chat-timeline-row')
  })

  test('should render basic row with addReactionBtn', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('message-id', 'msg-123')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const addBtn = el.querySelector('.reaction-trigger-icon')
    assert.ok(addBtn, 'addReactionBtn should exist via .reaction-trigger-icon class')
  })

  test('should toggle show-reaction-btn class on bubbleWrapper click', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('message-id', 'msg-123')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const addBtn = el.querySelector('.reaction-trigger-icon')
    const bubbleWrapper = addBtn?.parentElement
    assert.ok(bubbleWrapper, 'bubbleWrapper should exist as parent of reaction-trigger-icon')

    const container = el.querySelector('.atoll-chat-timeline-row')
    assert.ok(container, 'container should exist via .atoll-chat-timeline-row class')
    assert.ok(!container.classList.contains('show-reaction-btn'), 'Should not have show-reaction-btn class initially')

    // Click bubbleWrapper to show reaction button
    bubbleWrapper.click()
    assert.ok(container.classList.contains('show-reaction-btn'), 'Should have show-reaction-btn class after click')

    // Click bubbleWrapper again to hide reaction button
    bubbleWrapper.click()
    assert.ok(!container.classList.contains('show-reaction-btn'), 'Should remove show-reaction-btn class on second click')
  })

  test('should hide show-reaction-btn class on external document click', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('message-id', 'msg-123')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const addBtn = el.querySelector('.reaction-trigger-icon')
    const bubbleWrapper = addBtn?.parentElement
    const container = el.querySelector('.atoll-chat-timeline-row')

    // Click to show
    bubbleWrapper.click()
    assert.ok(container.classList.contains('show-reaction-btn'), 'Should show button')

    // Click external element
    const externalDiv = document.createElement('div')
    document.body.appendChild(externalDiv)
    externalDiv.click()

    assert.ok(!container.classList.contains('show-reaction-btn'), 'Should hide button on external click')
  })
})
