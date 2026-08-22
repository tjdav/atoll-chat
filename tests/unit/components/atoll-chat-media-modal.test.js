import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Chat Media Modal Component Tests', () => {
  let tagName
  const emittedEvents = []

  const listeners = {}

  const busMock = {
    emit (event, payload) {
      emittedEvents.push({
        event,
        payload
      })
      if (listeners[event]) {
        listeners[event].forEach(cb => cb(payload))
      }
    },
    on (event, cb) {
      if (!listeners[event]) {
        listeners[event] = []
      }
      listeners[event].push(cb)
    },
    off (event, cb) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(x => x !== cb)
      }
    }
  }

  const mockMessages = [
    {
      id: 'msg-1',
      message_id: 'msg-1',
      local_uuid: 'uuid-1',
      room_id: 'room-100',
      created_at: '2025-01-01T10:00:00.000Z',
      sender_id: 'user-2',
      attachments: [
        {
          id: 'att-10',
          media_id: 'media-img-1',
          file_key: 'key1',
          file_nonce: 'nonce1',
          mime_type: 'image/png',
          isImage: true,
          filename: 'cat.png'
        },
        {
          id: 'att-11',
          media_id: 'media-vid-1',
          file_key: 'key2',
          file_nonce: 'nonce2',
          mime_type: 'video/mp4',
          isVideo: true,
          filename: 'dog.mp4',
          duration: 15
        }
      ]
    },
    {
      id: 'msg-2',
      message_id: 'msg-2',
      local_uuid: 'uuid-2',
      room_id: 'room-100',
      created_at: '2025-01-01T11:00:00.000Z',
      sender_id: 'user-1',
      media_id: 'media-img-2',
      file_key: 'key3',
      file_nonce: 'nonce3',
      mime_type: 'image/jpeg',
      isImage: true,
      filename: 'landscape.jpg'
    }
  ]

  const mockRoom = {
    id: 'room-100',
    name: 'Media Test Room',
    participants: [
      {
        id: 'user-1',
        name: 'Alice',
        username: 'alice'
      },
      {
        id: 'user-2',
        name: 'Bob',
        username: 'bob'
      }
    ]
  }

  const storageMock = {
    getMessagesByRoom: async (roomId) => {
      if (roomId === 'room-100') {
        return mockMessages
      }
      return []
    },
    getRoom: async (roomId) => {
      if (roomId === 'room-100') {
        return mockRoom
      }
      return null
    }
  }

  const mediaMock = {
    decrypt: async (asset) => {
      if (asset.mime_type === 'video/mp4') {
        return 'blob:mock-decrypted-video'
      }
      return 'blob:mock-decrypted-image'
    }
  }

  const globalStoreMock = {
    $state: {
      currentUser: {
        id: 'user-1',
        username: 'alice'
      },
      mediaVolume: 0.8,
      decryptionCache: new Map(),
      subscribe: (_key, _cb) => {
        return () => {
        }
      }
    }
  }

  beforeEach(async () => {
    document.body.innerHTML = ''
    emittedEvents.length = 0

    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = () => 'blob:mock-url'
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      URL.revokeObjectURL = () => {
      }
    }

    // Mock IntersectionObserver
    globalThis.IntersectionObserver = class MockIntersectionObserver {
      constructor (cb) {
        this.cb = cb
      }
      observe (el) {
        this.cb([{
          isIntersecting: true,
          target: el
        }])
      }
      unobserve () {
      }
      disconnect () {
      }
    }

    // Polyfill HTMLDialogElement showModal/close in test DOM environment if missing
    if (typeof globalThis.HTMLDialogElement === 'undefined') {
      const BaseElement = globalThis.HTMLElement || class {
      }
      globalThis.HTMLDialogElement = class HTMLDialogElement extends BaseElement {
        showModal () {
          this.open = true
        }
        close () {
          this.open = false
        }
      }
    } else {
      if (!globalThis.HTMLDialogElement.prototype.showModal) {
        globalThis.HTMLDialogElement.prototype.showModal = function () {
          this.open = true
        }
      }
      if (!globalThis.HTMLDialogElement.prototype.close) {
        globalThis.HTMLDialogElement.prototype.close = function () {
          this.open = false
        }
      }
    }

    // Clear event listeners
    for (const key of Object.keys(listeners)) {
      delete listeners[key]
    }

    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    await loadComponent('atoll-profile')
    await loadComponent('ui-share-button')
    await loadComponent('atoll-slideshow')

    const mocks = {
      eventBus: { $bus: busMock },
      storage: { $storage: storageMock },
      globalStore: globalStoreMock,
      utils: {
        $time: {
          formatTime: () => '10:00 AM',
          formatDuration: (s) => `${s}s`
        },
        $media: mediaMock
      }
    }

    tagName = await loadComponent('atoll-chat-media-modal', mocks)
  })

  test('should instantiate atoll-chat-media-modal component', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.ok(element, 'Component should instantiate')
    const dialog = element.querySelector('dialog')
    assert.ok(dialog, '<dialog> element should exist in DOM')

    element.remove()
  })

  test('should open modal and populate chronological slides when ui:open_chat_media_modal is emitted', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    busMock.emit('ui:open_chat_media_modal', {
      roomId: 'room-100',
      mediaId: 'media-vid-1'
    })
    await new Promise(resolve => setTimeout(resolve, 100))

    const dialog = element.querySelector('dialog')
    assert.strictEqual(dialog.open, true, 'Dialog should be open')

    const titleEl = element.querySelector(`[id^="mediaModalTitle_"]`) || element.querySelector('h6')
    assert.strictEqual(titleEl.textContent, 'dog.mp4', 'Header title should display active media filename')

    const thumbs = element.querySelectorAll('.chat-media-thumb-item')
    assert.strictEqual(thumbs.length, 3, 'Should render 3 thumbnail items for all 3 media attachments in room')

    const slideshow = element.querySelector('atoll-slideshow')
    assert.ok(slideshow, '<atoll-slideshow> should be mounted in modal')

    element.remove()
  })

  test('should close modal on close button click or hide call', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    busMock.emit('ui:open_chat_media_modal', {
      roomId: 'room-100',
      mediaId: 'media-img-1'
    })
    await new Promise(resolve => setTimeout(resolve, 100))

    const btnClose = element.querySelector('[ref$="btnClose"]') || element.querySelector('atoll-button[title="Close Modal"]')
    const innerBtn = btnClose.querySelector('button') || btnClose
    innerBtn.click()

    await new Promise(resolve => setTimeout(resolve, 50))
    const dialog = element.querySelector('dialog')
    assert.strictEqual(dialog.open, false, 'Dialog should close after close button click')

    element.remove()
  })

  test('should toggle controls-hidden class when clicking media modal body', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    busMock.emit('ui:open_chat_media_modal', {
      roomId: 'room-100',
      mediaId: 'media-img-1'
    })
    await new Promise(resolve => setTimeout(resolve, 100))

    const dialog = element.querySelector('dialog')
    const modalBody = element.querySelector('[ref$="modalBody"]')

    assert.strictEqual(dialog.classList.contains('controls-hidden'), false)

    modalBody.click()
    assert.strictEqual(dialog.classList.contains('controls-hidden'), true, 'Should add controls-hidden on body tap')

    modalBody.click()
    assert.strictEqual(dialog.classList.contains('controls-hidden'), false, 'Should remove controls-hidden on second body tap')

    element.remove()
  })
})
