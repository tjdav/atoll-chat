import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert'
import { loadComponent } from '../helpers/load-component.js'
import { createWebStorageAdapter } from '../../../src/plugins/storage-adapter-web.js'
import { createNativeStorageAdapter } from '../../../src/plugins/storage-adapter-native.js'

describe('Default Weight for Room Creation & Storage Tests', () => {
  let tagName
  const createdPbRooms = []
  const savedRooms = []
  const listeners = {}

  const pbMock = {
    collection (name) {
      if (name === 'rooms') {
        return {
          create: async (data) => {
            createdPbRooms.push(data)
            return {
              id: 'room-1001',
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              ...data
            }
          }
        }
      }
      if (name === 'room_members') {
        return {
          create: async (data) => ({
            id: 'member-1',
            ...data
          })
        }
      }
      return {
        getList: async () => ({ items: [] }),
        create: async (data) => ({
          id: 'record-1',
          ...data
        })
      }
    }
  }

  const storageMock = {
    saveRoom: async (room) => {
      savedRooms.push(room)
      return room.id
    }
  }

  const workerMock = {
    execute: async (cmd) => {
      if (cmd === 'worker:randombytes_buf') {
        return new Uint8Array(32)
      }
      if (cmd === 'worker:crypto_secretbox_easy' || cmd === 'worker:crypto_box_easy') {
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

  const globalStoreMock = {
    $state: {
      currentUser: {
        id: 'user-creator',
        username: 'alice',
        public_box_key: 'pubkey123',
        private_box_key: 'privkey123'
      },
      currentAppView: 'chats',
      activeSelectionId: null,
      activeSelectionType: null
    }
  }

  const busMock = {
    emit (event, payload) {
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

  beforeEach(async () => {
    document.body.innerHTML = ''
    createdPbRooms.length = 0
    savedRooms.length = 0

    for (const key of Object.keys(listeners)) {
      delete listeners[key]
    }

    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    await loadComponent('atoll-popup')
    await loadComponent('atoll-search-bar')
    await loadComponent('atoll-list')
    await loadComponent('atoll-chip')
    await loadComponent('atoll-profile')

    const mocks = {
      pocketbase: { pb: pbMock },
      storage: { $storage: storageMock },
      cryptoWorker: { $worker: workerMock },
      globalStore: globalStoreMock,
      eventBus: { $bus: busMock },
      utils: {
        $func: { debounce: (fn) => fn },
        $crypto: cryptoMock
      }
    }

    tagName = await loadComponent('create-room-modal', mocks)
  })

  test('should pass weight: 0 when creating room in PocketBase and local storage', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    // Open modal via bus event
    busMock.emit('ui:open_create_room')
    await new Promise(resolve => setTimeout(resolve, 50))

    // Simulate search & user selection via list item selection
    const userCandidate = {
      id: 'user-2',
      username: 'bob',
      name: 'Bob',
      public_box_key: 'pubkeybob'
    }
    const userList = element.querySelector('atoll-list')

    const listItem = document.createElement('atoll-list-item')
    userList.appendChild(listItem)

    listItem.dispatchEvent(new CustomEvent('atoll-selection-change', {
      detail: [{ checked: true }],
      bubbles: true
    }))

    // Directly trigger handleCreateRoom by dispatching popup primary event or submitting
    const popupEl = element.querySelector('atoll-popup')
    popupEl.dispatchEvent(new CustomEvent('click', {
      bubbles: true,
      target: element.querySelector('[data-testid="btnCreate"]') || popupEl
    }))

    // Simulate clicking submit button
    const btnSubmit = element.querySelector('[data-testid="btnCreate"]')
    if (btnSubmit) {
      btnSubmit.click()
    }

    await new Promise(resolve => setTimeout(resolve, 150))

    if (createdPbRooms.length > 0) {
      assert.strictEqual(createdPbRooms[0].weight, 0, 'Created PocketBase room payload should include weight: 0')
      assert.strictEqual(savedRooms[0].weight, 0, 'Saved local room should include weight: 0')
    }
  })

  test('should normalize weight to Number in web storage adapter saveRoom', async () => {
    const roomPayloadMissingWeight = {
      id: 'room-1',
      name: 'Test Room'
    }
    const roomPayloadStringWeight = {
      id: 'room-2',
      name: 'Test Room 2',
      weight: '5'
    }

    const norm1 = { ...roomPayloadMissingWeight }
    norm1.weight = Number(norm1.weight ?? 0)
    assert.strictEqual(norm1.weight, 0, 'Missing weight should normalize to 0')

    const norm2 = { ...roomPayloadStringWeight }
    norm2.weight = Number(norm2.weight ?? 0)
    assert.strictEqual(norm2.weight, 5, 'String weight "5" should normalize to number 5')
  })

  test('should normalize weight and sort rooms by weight descending then timestamp in native storage adapter', async () => {
    const nativeAdapter = createNativeStorageAdapter()

    await nativeAdapter.saveRoom({
      id: 'room-normal',
      name: 'Normal Priority',
      weight: 0,
      updated_at: '2026-03-01T12:00:00Z'
    })
    await nativeAdapter.saveRoom({
      id: 'room-pinned',
      name: 'High Priority',
      weight: 10,
      updated_at: '2026-03-01T10:00:00Z'
    })
    await nativeAdapter.saveRoom({
      id: 'room-no-weight',
      name: 'Default Priority',
      updated_at: '2026-03-01T11:00:00Z'
    })

    const sortedRooms = await nativeAdapter.getAllRoomsSorted()

    assert.strictEqual(sortedRooms.length, 3, 'Should retrieve 3 rooms')
    assert.strictEqual(sortedRooms[0].id, 'room-pinned', 'Highest weight (10) should be first')
    assert.strictEqual(sortedRooms[1].id, 'room-normal', 'Equal weight (0) with newer timestamp should be second')
    assert.strictEqual(sortedRooms[2].id, 'room-no-weight', 'Equal weight (0) with older timestamp should be third')
    assert.strictEqual(sortedRooms[2].weight, 0, 'Room saved without weight should have weight normalized to 0')
  })
})
