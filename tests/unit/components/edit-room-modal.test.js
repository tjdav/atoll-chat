import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Edit Room Modal Component Tests', () => {
  let tagName
  const emittedEvents = []
  const updatedRooms = []
  const updatedPbRooms = []
  const createdMedia = []

  let compressCalled = false
  let decryptCalled = false
  let shouldFailPbUpdate = false

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

  const storageMock = {
    updateRoom: async (roomId, update) => {
      updatedRooms.push({
        roomId,
        update
      })
    }
  }

  const pbMock = {
    collection (name) {
      if (name === 'rooms') {
        return {
          update: async (id, data) => {
            if (shouldFailPbUpdate) {
              throw new Error('Network failure during room update')
            }
            updatedPbRooms.push({
              id,
              data
            })
            return {
              id,
              ...data
            }
          }
        }
      }
      if (name === 'media') {
        return {
          create: async (formData) => {
            createdMedia.push(formData)
            return {
              id: 'media-123',
              file: 'avatar.bin'
            }
          }
        }
      }
      return {}
    }
  }

  const mediaMock = {
    decrypt: async () => {
      decryptCalled = true
      return 'blob:mock-decrypted-avatar'
    },
    compressImage: async (file) => {
      compressCalled = true
      return new Blob([await file.arrayBuffer()], { type: 'image/jpeg' })
    }
  }

  const workerMock = {
    execute: async (cmd) => {
      if (cmd === 'worker:randombytes_buf') {
        return new Uint8Array(32)
      }
      if (cmd === 'worker:crypto_secretbox_easy') {
        return new Uint8Array([1, 2, 3, 4])
      }
      return new Uint8Array(32)
    }
  }

  const cryptoMock = {
    toBase64: (uint8Array) => {
      let binary = ''
      for (let i = 0; i < uint8Array.byteLength; i++) {
        binary += String.fromCharCode(uint8Array[i])
      }
      return btoa(binary)
    }
  }

  beforeEach(async () => {
    document.body.innerHTML = ''
    emittedEvents.length = 0
    updatedRooms.length = 0
    updatedPbRooms.length = 0
    createdMedia.length = 0
    compressCalled = false
    decryptCalled = false
    shouldFailPbUpdate = false

    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = () => 'blob:mock-url'
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      URL.revokeObjectURL = () => {
      }
    }

    // Clear event listeners
    for (const key of Object.keys(listeners)) {
      delete listeners[key]
    }

    // Register child custom elements if not defined
    if (!customElements.get('atoll-popup')) {
      customElements.define('atoll-popup', class extends HTMLElement {
        show () {
          this.setAttribute('open', 'true')
        }
        hide () {
          this.removeAttribute('open')
        }
      })
    }
    if (!customElements.get('atoll-button')) {
      customElements.define('atoll-button', class extends HTMLElement {
        constructor () {
          super()
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
      eventBus: { $bus: busMock },
      storage: { $storage: storageMock },
      pocketbase: { pb: pbMock },
      cryptoWorker: { $worker: workerMock },
      utils: {
        $crypto: cryptoMock,
        $media: mediaMock,
        $url: { normalizeUrl: (url) => url }
      }
    }

    tagName = await loadComponent('edit-room-modal', mocks)
  })

  test('should instantiate edit-room-modal component successfully', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)

    await new Promise(resolve => setTimeout(resolve, 50))
    assert.ok(element, 'Component should instantiate')

    element.remove()
  })

  test('should open modal and populate room details via ui:open_edit_room event', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    const sampleRoom = {
      id: 'room-abc',
      name: 'General Chat',
      avatar: JSON.stringify({
        media_id: 'media-1',
        key: 'key123',
        nonce: 'nonce123'
      }),
      key_history: [{
        epoch_id: 1,
        key: 'roomSecretKey'
      }]
    }

    busMock.emit('ui:open_edit_room', sampleRoom)
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.strictEqual(decryptCalled, true, '$media.decrypt should be called for room with avatar')

    const input = element.querySelector('[data-testid="editRoomNameInput"]')
    assert.strictEqual(input.value, 'General Chat', 'Room name input should be populated')

    element.remove()
  })

  test('should handle save button disabled state based on dirty state reactivity', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    const sampleRoom = {
      id: 'room-dirty-check',
      name: 'Original Name',
      key_history: [{
        epoch_id: 1,
        key: 'roomSecretKey'
      }]
    }

    busMock.emit('ui:open_edit_room', sampleRoom)
    await new Promise(resolve => setTimeout(resolve, 50))

    const input = element.querySelector('[data-testid="editRoomNameInput"]')
    const btnSave = element.querySelector('[data-testid="btnSaveRoom"]')

    assert.ok(btnSave.hasAttribute('disabled'), 'Save button should be disabled when room name is unchanged')

    // Change room name
    input.value = 'Modified Name'
    input.dispatchEvent(new Event('input'))
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.strictEqual(btnSave.hasAttribute('disabled'), false, 'Save button should be enabled when room name is modified')

    // Reset room name back to initial
    input.value = 'Original Name'
    input.dispatchEvent(new Event('input'))
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.ok(btnSave.hasAttribute('disabled'), 'Save button should be disabled when reset back to initial name')

    element.remove()
  })

  test('should enable save button when avatar is selected or cleared', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    const sampleRoom = {
      id: 'room-avatar-dirty',
      name: 'Avatar Test Room',
      avatar: JSON.stringify({ media_id: 'media-99' }),
      key_history: [{
        epoch_id: 1,
        key: 'roomSecretKey'
      }]
    }

    busMock.emit('ui:open_edit_room', sampleRoom)
    await new Promise(resolve => setTimeout(resolve, 50))

    const btnClearAvatar = element.querySelector('[data-testid="btnClearAvatar"]')
    const btnSave = element.querySelector('[data-testid="btnSaveRoom"]')

    // Click clear avatar button
    btnClearAvatar.click()
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.strictEqual(btnSave.hasAttribute('disabled'), false, 'Save button should be enabled when avatar is cleared')

    element.remove()
  })

  test('should execute save workflow compressing new image and updating storage and PocketBase', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    const sampleRoom = {
      id: 'room-save-test',
      name: 'Old Name',
      key_history: [{
        epoch_id: 1,
        key: 'roomSecretKey'
      }]
    }

    busMock.emit('ui:open_edit_room', sampleRoom)
    await new Promise(resolve => setTimeout(resolve, 50))

    const input = element.querySelector('[data-testid="editRoomNameInput"]')
    const avatarInput = element.querySelector('[data-testid="editAvatarInput"]')

    input.value = 'New Room Name'
    input.dispatchEvent(new Event('input'))

    // Attach mock file
    const file = new File(['dummy-image-content'], 'test.png', { type: 'image/png' })
    Object.defineProperty(avatarInput, 'files', {
      value: [file]
    })
    avatarInput.dispatchEvent(new Event('change'))

    await new Promise(resolve => setTimeout(resolve, 50))

    const btnSave = element.querySelector('[data-testid="btnSaveRoom"]')
    btnSave.dispatchEvent(new Event('click', { bubbles: true }))

    await new Promise(resolve => setTimeout(resolve, 200))

    if (updatedPbRooms.length === 0) {
      const dangerToast = emittedEvents.find(e => e.event === 'ui:show_toast' && e.payload.type === 'danger')
      if (dangerToast) {
        assert.fail(`saveChanges failed with error: ${dangerToast.payload.message}`)
      }
    }

    assert.strictEqual(compressCalled, true, 'Image compression should be executed on file upload')
    assert.strictEqual(updatedPbRooms.length, 1, 'PocketBase rooms collection should be updated')
    assert.strictEqual(updatedRooms.length, 1, 'Local storage should be updated')
    assert.strictEqual(updatedRooms[0].update.name, 'New Room Name', 'Updated room name should match')

    const newLocalRoomEvent = emittedEvents.find(e => e.event === 'db:new_local_room')
    const memberUpdatedEvent = emittedEvents.find(e => e.event === 'room:member_updated')
    const toastEvent = emittedEvents.find(e => e.event === 'ui:show_toast' && e.payload.type === 'success')

    assert.ok(newLocalRoomEvent, 'db:new_local_room event should be emitted')
    assert.ok(memberUpdatedEvent, 'room:member_updated event should be emitted')
    assert.ok(toastEvent, 'Success toast notification should be emitted')

    element.remove()
  })

  test('should trigger save on Enter key press in room name input when canSave is true', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    const sampleRoom = {
      id: 'room-enter-key',
      name: 'Initial Room Name',
      key_history: [{
        epoch_id: 1,
        key: 'roomSecretKey'
      }]
    }

    busMock.emit('ui:open_edit_room', sampleRoom)
    await new Promise(resolve => setTimeout(resolve, 50))

    const input = element.querySelector('[data-testid="editRoomNameInput"]')
    input.value = 'Updated Room Name via Enter'
    input.dispatchEvent(new Event('input'))
    await new Promise(resolve => setTimeout(resolve, 50))

    // Press Enter key on input
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await new Promise(resolve => setTimeout(resolve, 150))

    assert.strictEqual(updatedRooms.length, 1, 'Storage should be updated after Enter key submission')
    assert.strictEqual(updatedRooms[0].update.name, 'Updated Room Name via Enter')

    element.remove()
  })

  test('should handle save error gracefully displaying error toast', async () => {
    shouldFailPbUpdate = true

    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    const sampleRoom = {
      id: 'room-err-test',
      name: 'Initial Name',
      key_history: [{
        epoch_id: 1,
        key: 'roomSecretKey'
      }]
    }

    busMock.emit('ui:open_edit_room', sampleRoom)
    await new Promise(resolve => setTimeout(resolve, 50))

    const input = element.querySelector('[data-testid="editRoomNameInput"]')
    input.value = 'New Name Triggering Error'
    input.dispatchEvent(new Event('input'))
    await new Promise(resolve => setTimeout(resolve, 50))

    const btnSave = element.querySelector('[data-testid="btnSaveRoom"]')

    try {
      btnSave.dispatchEvent(new Event('click', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 150))
    } catch {
      // Expected caught error
    }

    const errorToast = emittedEvents.find(e => e.event === 'ui:show_toast' && e.payload.type === 'danger')
    assert.ok(errorToast, 'Error toast notification should be emitted on save failure')
    assert.ok(errorToast.payload.message.includes('Network failure'), 'Error toast should include error message')

    element.remove()
  })
})
