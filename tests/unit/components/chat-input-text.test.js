import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Chat Input Text Component', () => {
  let tagName
  const emittedEvents = []

  // Single, persistent mock objects across all tests to handle custom element registry re-use
  const globalState = {
    activeSelectionId: 'room123',
    currentMessageText: '',
    currentUser: { id: 'user555' },
    subscriptions: {},
    subscribe (key, cb) {
      if (!this.subscriptions[key]) {
        this.subscriptions[key] = []
      }
      this.subscriptions[key].push(cb)
      return () => {
        this.subscriptions[key] = this.subscriptions[key].filter(x => x !== cb)
      }
    },
    trigger (key, val) {
      if (this.subscriptions[key]) {
        this.subscriptions[key].forEach(cb => cb(val))
      }
    }
  }

  let mockStateRecord = {
    id: 'stateRecordId',
    is_typing: false
  }

  const pbMock = {
    updates: [],
    creates: [],
    queries: [],
    collection: () => ({
      getFirstListItem: async (query) => {
        pbMock.queries.push(query)
        if (pbMock.shouldThrowFirstListItem) {
          throw new Error('Not found')
        }
        return mockStateRecord
      },
      update: async (id, data) => {
        const payload = {
          id,
          data
        }
        pbMock.updates.push(payload)
        mockStateRecord = {
          ...mockStateRecord,
          ...data
        }
        return mockStateRecord
      },
      create: async (data) => {
        pbMock.creates.push(data)
        mockStateRecord = {
          id: 'newStateRecordId',
          ...data
        }
        return mockStateRecord
      }
    }),
    shouldThrowFirstListItem: false
  }

  const mockStorage = {
    getRoom: async (roomId) => {
      return {
        id: roomId,
        read_receipts: true
      }
    }
  }

  beforeEach(async () => {
    document.body.innerHTML = ''
    emittedEvents.length = 0

    // Reset globalState
    globalState.activeSelectionId = 'room123'
    globalState.currentMessageText = ''
    globalState.currentUser = { id: 'user555' }
    globalState.subscriptions = {}
    globalState.busListeners = {}

    // Reset pbMock
    pbMock.updates.length = 0
    pbMock.creates.length = 0
    pbMock.queries.length = 0
    pbMock.shouldThrowFirstListItem = false
    mockStateRecord = {
      id: 'stateRecordId',
      is_typing: false
    }

    // Define child components if not defined
    if (!customElements.get('atoll-button')) {
      customElements.define('atoll-button', class extends HTMLElement {
        constructor () {
          super()
          this.innerHTML = '<button><slot></slot></button>'
        }
      })
    }
    if (!customElements.get('atoll-icon')) {
      customElements.define('atoll-icon', class extends HTMLElement {
        static get observedAttributes () {
          return ['name']
        }
        attributeChangedCallback () {
        }
      })
    }

    const mocks = {
      globalStore: {
        $state: globalState
      },
      utils: {
        $device: {
          isTouch: () => globalState.isTouchDevice ?? false
        }
      },
      eventBus: {
        $bus: {
          emit: (name, payload) => {
            emittedEvents.push({
              name,
              payload
            })
          },
          on: (name, cb) => {
            if (!globalState.busListeners) {
              globalState.busListeners = {}
            }
            if (!globalState.busListeners[name]) {
              globalState.busListeners[name] = []
            }
            globalState.busListeners[name].push(cb)
          },
          off: () => {
          },
          triggerBus: (name, payload) => {
            if (globalState.busListeners && globalState.busListeners[name]) {
              globalState.busListeners[name].forEach(cb => cb(payload))
            }
          }
        }
      },
      pocketbase: {
        pb: pbMock
      },
      storage: {
        $storage: mockStorage
      }
    }

    tagName = await loadComponent('atoll-chat-input-text', mocks)
  })

  test('should render templates correctly with enhanced attributes and styles', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const textarea = el.querySelector('textarea')
    assert.ok(textarea, 'Textarea should be rendered')
    assert.equal(textarea.getAttribute('aria-label'), 'Type a message', 'Should have accessible ARIA label')
    assert.equal(textarea.getAttribute('enterkeyhint'), 'send', 'Should have correct enterkeyhint')
    assert.equal(textarea.style.resize, 'none', 'Should have resize styling set to none')
    assert.equal(textarea.style.maxHeight, '160px', 'Should have max-height styling set to 160px')

    const fileInput = el.querySelector('input[type="file"]')
    assert.equal(fileInput.getAttribute('aria-hidden'), 'true', 'File input should be hidden from ARIA')
    assert.equal(fileInput.getAttribute('tabindex'), '-1', 'File input should have tabindex of -1')

    const sendButton = el.querySelector('.atoll-chat-input-btn-send')
    assert.ok(sendButton, 'Send button should exist')
    assert.equal(sendButton.getAttribute('title'), 'Send Message', 'Send button should have descriptive title')
  })

  test('should emit ui:send_clicked when Enter is pressed without Shift', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const textarea = el.querySelector('textarea')
    const keydownEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      bubbles: true,
      cancelable: true
    })

    // Simulate keydown event
    textarea.dispatchEvent(keydownEvent)

    const sendEvent = emittedEvents.find(e => e.name === 'ui:send_clicked')
    assert.ok(sendEvent, 'Should emit ui:send_clicked on Enter keypress')
  })

  test('should emit ui:send_clicked when Ctrl+Enter or Cmd+Enter is pressed', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const textarea = el.querySelector('textarea')
    const keydownEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
      bubbles: true,
      cancelable: true
    })

    textarea.dispatchEvent(keydownEvent)

    const sendEvent = emittedEvents.find(e => e.name === 'ui:send_clicked')
    assert.ok(sendEvent, 'Should emit ui:send_clicked on Ctrl+Enter')
  })

  test('should not emit ui:send_clicked when Enter is pressed with ShiftKey', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const textarea = el.querySelector('textarea')
    const keydownEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true
    })

    textarea.dispatchEvent(keydownEvent)

    const sendEvent = emittedEvents.find(e => e.name === 'ui:send_clicked')
    assert.equal(sendEvent, undefined, 'Should not emit ui:send_clicked on Shift+Enter')
  })

  test('should handle pasting files correctly', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const textarea = el.querySelector('textarea')
    const file = new File(['dummy content'], 'screenshot.png', { type: 'image/png' })

    const pasteEvent = new Event('paste', {
      bubbles: true,
      cancelable: true
    })
    pasteEvent.clipboardData = {
      files: [file],
      getData: () => ''
    }

    textarea.dispatchEvent(pasteEvent)

    const fileSelectedEvent = emittedEvents.find(e => e.name === 'ui:file_selected')
    assert.ok(fileSelectedEvent, 'Should emit ui:file_selected event')
    assert.equal(fileSelectedEvent.payload.file.name, 'screenshot.png', 'Should carry the correct file payload')
  })

  test('should clean up typing indicators on disconnect/abort', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const textarea = el.querySelector('textarea')
    textarea.value = 'typing something...'
    textarea.dispatchEvent(new Event('input'))

    // Let the macro task run to execute the async setServerTyping
    await new Promise(resolve => setTimeout(resolve, 20))

    // Verify it attempted to fetch and set typing as true
    assert.ok(pbMock.updates.length > 0 || pbMock.creates.length > 0, 'Should update or create typing state on input')

    // Disconnect component
    document.body.removeChild(el)
    await new Promise(resolve => setTimeout(resolve, 50))

    // Verify it set typing to false on abort
    assert.ok(pbMock.updates.length > 0, 'Should perform update on cleanup')
    const lastUpdate = pbMock.updates[pbMock.updates.length - 1]
    assert.equal(lastUpdate.data.is_typing, false, 'Should update is_typing to false on cleanup')
  })

  test('should handle activeSelectionId changes and reset previous room typing', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const textarea = el.querySelector('textarea')
    textarea.value = 'typing...'
    textarea.dispatchEvent(new Event('input'))

    // Wait for the async typing lookup to finish
    await new Promise(resolve => setTimeout(resolve, 20))

    // Change room Selection ID
    globalState.activeSelectionId = 'room456'
    globalState.trigger('activeSelectionId', 'room456')

    // Wait for async update
    await new Promise(resolve => setTimeout(resolve, 50))

    // Ensure it reset typing for 'room123' (the previous room)
    assert.ok(pbMock.updates.length > 0, 'Should have reset the typing state via pocketbase update')
    const lastUpdate = pbMock.updates[pbMock.updates.length - 1]
    assert.equal(lastUpdate.data.is_typing, false, 'is_typing should be set to false for the old room')
  })

  test('should focus messageInput on ui:focus_input even when isTouch is true', async () => {
    globalState.isTouchDevice = true
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const textarea = el.querySelector('textarea')
    let focused = false
    textarea.focus = () => {
      focused = true
    }

    // Trigger ui:focus_input
    if (globalState.busListeners && globalState.busListeners['ui:focus_input']) {
      globalState.busListeners['ui:focus_input'].forEach(cb => cb())
    }

    // Wait for requestAnimationFrame
    await new Promise(resolve => requestAnimationFrame(resolve))

    assert.equal(focused, true, 'messageInput.focus() should be called even on touch devices')
    const scrollEvent = emittedEvents.find(e => e.name === 'ui:scroll_to_bottom')
    assert.ok(scrollEvent, 'ui:scroll_to_bottom should be emitted on touch devices')
  })

  test('should prevent default on sendButton pointerdown to keep focus on textarea', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const sendButton = el.querySelector('.atoll-chat-input-btn-send')
    assert.ok(sendButton, 'Send button should exist')

    let defaultPrevented = false
    const pointerDownEvent = new Event('pointerdown', {
      bubbles: true,
      cancelable: true
    })
    pointerDownEvent.preventDefault = () => {
      defaultPrevented = true
    }

    sendButton.dispatchEvent(pointerDownEvent)
    assert.equal(defaultPrevented, true, 'pointerdown event default action should be prevented on sendButton')
  })

  test('should keep messageInput enabled when isSending is true but isUploading/isCompressing are false', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('is-sending', 'true')
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const textarea = el.querySelector('textarea')
    assert.equal(textarea.disabled, false, 'messageInput should not be disabled when isSending is true')

    const sendButton = el.querySelector('.atoll-chat-input-btn-send')
    assert.equal(sendButton.hasAttribute('disabled'), true, 'sendButton should be disabled when isSending is true')
  })
})
