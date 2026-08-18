import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Room Details Sidebar Component Avatar State Retention', () => {
  let tagName

  const mockState = {
    activeSelectionId: 'room1',
    currentUser: { id: 'user_alice' },
    users: {},
    listeners: {},
    subscribe (key, cb) {
      if (!this.listeners[key]) {
        this.listeners[key] = new Set()
      }
      this.listeners[key].add(cb)
      return () => {
        this.listeners[key]?.delete(cb)
      }
    },
    emit (key, payload) {
      this.listeners[key]?.forEach(cb => cb(payload))
    }
  }

  const mockPb = {
    baseUrl: 'https://example.com/',
    files: {
      getURL (record, filename, options = {}) {
        return `https://example.com/api/files/${record.collectionId || 'users'}/${record.id}/${filename}`
      }
    },
    collection () {
      return {
        getFullList: async () => [],
        getFirstListItem: async () => {
          throw new Error('Not found')
        }
      }
    },
    filter (str, params) {
      return str
    }
  }

  const roomsStore = {
    room1: {
      id: 'room1',
      name: 'Alice & Bob',
      is_group: false,
      avatar: JSON.stringify({ media_id: 'media_123' }),
      participants: [
        {
          id: 'user_alice',
          name: 'Alice'
        },
        {
          id: 'user_bob',
          name: 'Bob',
          avatar: 'bob.jpg'
        }
      ]
    },
    room2: {
      id: 'room2',
      name: 'Alice & Charlie',
      is_group: false,
      avatar: null,
      participants: [
        {
          id: 'user_alice',
          name: 'Alice'
        },
        {
          id: 'user_charlie',
          name: 'Charlie',
          avatar: ''
        }
      ]
    },
    room3: {
      id: 'room3',
      name: 'Alice & David',
      is_group: false,
      avatar: null,
      participants: [
        {
          id: 'user_alice',
          name: 'Alice'
        },
        {
          id: 'user_david',
          name: 'David',
          avatar: 'david.jpg'
        }
      ]
    },
    room4: {
      id: 'room4',
      name: 'Group Chat',
      is_group: true,
      avatar: null,
      participants: [
        {
          id: 'user_alice',
          name: 'Alice'
        },
        {
          id: 'user_bob',
          name: 'Bob',
          avatar: 'bob.jpg'
        },
        {
          id: 'user_charlie',
          name: 'Charlie',
          avatar: ''
        }
      ]
    }
  }

  const mockStorage = {
    getRoom: async (id) => roomsStore[id] || null
  }

  const mockUtils = {
    $crypto: {
      toBase64: () => ''
    },
    $media: {
      decrypt: async () => 'blob:https://example.com/decrypted-avatar'
    }
  }

  const mockCryptoWorker = {
    $worker: {
      execute: async () => new Uint8Array()
    }
  }

  const mockEventBus = {
    $bus: {
      on: () => {
      },
      off: () => {
      },
      emit: () => {
      }
    }
  }

  beforeEach(async () => {
    document.body.innerHTML = ''

    mockState.activeSelectionId = 'room1'
    mockState.listeners = {}

    // First load profile component so atoll-profile custom element is registered
    await loadComponent('atoll-profile', {
      globalStore: { $state: mockState },
      pocketbase: { pb: mockPb },
      storage: { $storage: mockStorage }
    })

    tagName = await loadComponent('room-details-sidebar', {
      globalStore: { $state: mockState },
      pocketbase: { pb: mockPb },
      storage: { $storage: mockStorage },
      utils: mockUtils,
      cryptoWorker: mockCryptoWorker,
      eventBus: mockEventBus
    })
  })

  test('should set decrypted src when room avatar is present', async () => {
    mockState.activeSelectionId = 'room1'
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const avatarComp = el.querySelector('[ref="roomAvatar"]') || el.querySelector('atoll-profile')
    assert.ok(avatarComp, 'roomAvatar element should exist')
    assert.equal(avatarComp.getAttribute('src'), 'blob:https://example.com/decrypted-avatar')
    assert.equal(avatarComp.getAttribute('user-id'), null)
  })

  test('should reset src when switching from custom room avatar to direct chat with no participant avatar', async () => {
    mockState.activeSelectionId = 'room1'
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const avatarComp = el.querySelector('[ref="roomAvatar"]') || el.querySelector('atoll-profile')
    assert.equal(avatarComp.getAttribute('src'), 'blob:https://example.com/decrypted-avatar')

    // Switch active selection to room2 (Charlie, no avatar)
    mockState.activeSelectionId = 'room2'
    mockState.emit('activeSelectionId', 'room2')

    await new Promise(resolve => setTimeout(resolve, 50))

    assert.equal(avatarComp.getAttribute('src'), null, 'src attribute must be removed when participant has no avatar')
    assert.equal(avatarComp.getAttribute('user-id'), 'user_charlie')
    assert.equal(avatarComp.getAttribute('name'), 'Charlie')
  })

  test('should update src with participant avatar when switching to direct chat with participant avatar', async () => {
    mockState.activeSelectionId = 'room2'
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const avatarComp = el.querySelector('[ref="roomAvatar"]') || el.querySelector('atoll-profile')
    assert.equal(avatarComp.getAttribute('src'), null)

    // Switch active selection to room3 (David, with avatar david.jpg)
    mockState.activeSelectionId = 'room3'
    mockState.emit('activeSelectionId', 'room3')

    await new Promise(resolve => setTimeout(resolve, 50))

    assert.ok(avatarComp.getAttribute('src')?.includes('david.jpg'), 'src attribute should reflect user avatar URL')
    assert.equal(avatarComp.getAttribute('user-id'), 'user_david')
  })

  test('should clear src and user-id when switching to group chat', async () => {
    mockState.activeSelectionId = 'room1'
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const avatarComp = el.querySelector('[ref="roomAvatar"]') || el.querySelector('atoll-profile')

    // Switch active selection to room4 (Group Chat)
    mockState.activeSelectionId = 'room4'
    mockState.emit('activeSelectionId', 'room4')

    await new Promise(resolve => setTimeout(resolve, 50))

    assert.equal(avatarComp.getAttribute('src'), null)
    assert.equal(avatarComp.getAttribute('user-id'), null)
    assert.equal(avatarComp.getAttribute('type'), 'multiparty')
  })
})
