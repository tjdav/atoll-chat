import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Theme Selector Modal Component', () => {
  let tagName

  // Suite-level mutable singletons
  const mockRoom = {
    id: 'room_123',
    name: 'Test Room',
    theme: 'classic',
    key_history: [{
      epoch_id: 1,
      key: 'mock_key'
    }],
    custom_theme: null
  }

  const emittedEvents = []
  let savedRoom = null
  let pocketbaseUpdated = false

  const sharedState = {
    activeSelectionId: 'room_123'
  }

  const sharedEventBus = {
    $bus: {
      on (event, callback) {
        this._listeners = this._listeners || {}
        this._listeners[event] = this._listeners[event] || []
        this._listeners[event].push(callback)
      },
      emit (event, payload) {
        emittedEvents.push({
          event,
          payload
        })
        if (this._listeners && this._listeners[event]) {
          this._listeners[event].forEach(cb => cb(payload))
        }
      }
    }
  }

  const sharedStorage = {
    $storage: {
      async getRoom (id) {
        return mockRoom
      },
      async saveRoom (room) {
        savedRoom = room
      }
    }
  }

  const sharedPocketbase = {
    pb: {
      collection (name) {
        return {
          async update (id, data) {
            pocketbaseUpdated = true
            return {
              id,
              ...data
            }
          }
        }
      }
    }
  }

  const sharedCryptoWorker = {
    $worker: {
      async execute (cmd, params) {
        if (cmd === 'worker:randombytes_buf') {
          return new Uint8Array(24)
        }
        if (cmd === 'worker:crypto_secretbox_easy') {
          return new Uint8Array([1, 2, 3, 4])
        }
        return null
      }
    }
  }

  const sharedUtils = {
    $crypto: {
      toBase64 (arr) {
        return 'mock_b64'
      }
    }
  }

  beforeEach(async () => {
    document.body.innerHTML = ''
    emittedEvents.length = 0
    savedRoom = null
    pocketbaseUpdated = false

    mockRoom.id = 'room_123'
    mockRoom.name = 'Test Room'
    mockRoom.theme = 'classic'
    mockRoom.key_history = [{
      epoch_id: 1,
      key: 'mock_key'
    }]
    mockRoom.custom_theme = null

    // Load nested dependencies
    await loadComponent('atoll-icon')
    await loadComponent('atoll-popup')
    await loadComponent('atoll-list-item')
    await loadComponent('atoll-list')

    tagName = await loadComponent('atoll-theme-selector-modal', {
      globalStore: { $state: sharedState },
      eventBus: sharedEventBus,
      storage: sharedStorage,
      pocketbase: sharedPocketbase,
      cryptoWorker: sharedCryptoWorker,
      utils: sharedUtils
    })
  })

  test('should instantiate component and expose public show and hide methods on host root', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.equal(typeof el.show, 'function', 'el.show should be exposed on component host')
    assert.equal(typeof el.hide, 'function', 'el.hide should be exposed on component host')
  })

  test('should open modal and hydrate active room theme on show()', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 50))

    await el.show()
    await new Promise(resolve => setTimeout(resolve, 50))

    const preview = el.querySelector('.preview-chat-window')
    assert.ok(preview, 'preview chat window should exist')
    assert.equal(preview.getAttribute('data-theme'), 'classic', 'preview theme should reflect room theme')
  })

  test('should toggle checkmark and controls when selecting custom theme', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 50))

    await el.show()
    await new Promise(resolve => setTimeout(resolve, 50))

    const themeCustomItem = el.querySelector('[data-testid="theme-custom-item"]')
    assert.ok(themeCustomItem, 'custom theme item should exist')

    themeCustomItem.click()
    await new Promise(resolve => setTimeout(resolve, 50))

    const customControls = el.querySelector('[data-testid="custom-theme-controls"]')
    assert.ok(customControls)
    assert.equal(customControls.classList.contains('d-none'), false, 'custom theme controls should be visible when custom is selected')

    const checkCustom = el.querySelector('[data-testid="checkCustom"]') || el.querySelector('[data-testid$="checkCustom"]')
    assert.ok(checkCustom)
    assert.equal(checkCustom.classList.contains('d-none'), false, 'custom checkmark should be visible')
  })

  test('should validate uploaded file type and reject non-image uploads', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 50))

    await el.show()
    await new Promise(resolve => setTimeout(resolve, 50))

    const uploader = el.querySelector('[data-testid="custom-image-uploader"]')
    assert.ok(uploader)

    const invalidFile = new File(['dummy content'], 'document.pdf', { type: 'application/pdf' })
    Object.defineProperty(uploader, 'files', {
      value: [invalidFile],
      writable: true,
      configurable: true
    })

    uploader.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 50))

    const toast = emittedEvents.find(e => e.event === 'ui:show_toast' && e.payload?.type === 'danger')
    assert.ok(toast, 'should emit danger toast for invalid file type')
    assert.match(toast.payload.message, /valid image file/i)
  })

  test('should save theme on popup primary button press', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 50))

    await el.show()
    await new Promise(resolve => setTimeout(resolve, 50))

    const popup = el.querySelector('atoll-popup')
    assert.ok(popup, 'atoll-popup should exist')

    popup.dispatchEvent(new CustomEvent('atoll-popup-primary', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 100))

    assert.equal(pocketbaseUpdated, true, 'PocketBase collection should be updated')
    assert.ok(savedRoom, 'Room should be saved in local storage')
    assert.equal(savedRoom.theme, 'classic', 'Room theme should be updated')

    const updatedToast = emittedEvents.find(e => e.event === 'ui:show_toast' && e.payload?.type === 'success')
    assert.ok(updatedToast, 'success toast should be emitted')
  })

  test('should associate labels and inputs using dynamic ref token IDs', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 50))

    const uploaderInput = el.querySelector('[data-testid="custom-image-uploader"]')
    const uploaderLabel = el.querySelector('label[for="' + uploaderInput.id + '"]')
    assert.ok(uploaderInput.id, 'uploader input should have dynamic ID')
    assert.ok(uploaderLabel, 'label should match uploader input dynamic ID')

    const bgToggleInput = el.querySelector('[data-testid="use-bg-image-toggle"]')
    const bgToggleLabel = el.querySelector('label[for="' + bgToggleInput.id + '"]')
    assert.ok(bgToggleInput.id, 'bg toggle input should have dynamic ID')
    assert.notEqual(bgToggleInput.id, 'useBgImageToggle', 'should not use static ID')
    assert.ok(bgToggleLabel, 'label should match bg toggle input dynamic ID')

    const blurSlider = el.querySelector('[data-testid="blur-slider"]')
    const blurLabel = el.querySelector('label[for="' + blurSlider.id + '"]')
    assert.ok(blurSlider.id, 'blur slider should have dynamic ID')
    assert.notEqual(blurSlider.id, 'blurSlider', 'should not use static ID')
    assert.ok(blurLabel, 'label should match blur slider dynamic ID')

    const dimSlider = el.querySelector('[data-testid="dim-slider"]')
    const dimLabel = el.querySelector('label[for="' + dimSlider.id + '"]')
    assert.ok(dimSlider.id, 'dim slider should have dynamic ID')
    assert.notEqual(dimSlider.id, 'dimSlider', 'should not use static ID')
    assert.ok(dimLabel, 'label should match dim slider dynamic ID')
  })
})
