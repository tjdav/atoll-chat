import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Chat List Component', () => {
  let tagName
  const emittedEvents = []

  // Suite-level persistent singleton objects for test execution across instances
  const globalState = {
    currentUser: {
      id: 'user1',
      name: 'User One'
    },
    currentAppView: 'chats',
    activeSelectionId: null,
    activeSelectionType: null,
    listSearchQuery: '',
    listScrollPositions: {},
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
      this[key] = val
      if (this.subscriptions[key]) {
        this.subscriptions[key].forEach(cb => cb(val))
      }
    }
  }

  let mockRooms = []
  let mockMessages = {}

  const mockStorage = {
    getAllRoomsSorted: async () => {
      return mockRooms
    },
    getRoom: async (id) => {
      return mockRooms.find(r => r.id === id) || null
    },
    getMessagesByRoom: async (id, limit) => {
      const msgs = mockMessages[id] || []
      return limit ? msgs.slice(0, limit) : msgs
    },
    getLatestMessage: async (id) => {
      const msgs = mockMessages[id] || []
      return msgs[msgs.length - 1] || null
    },
    saveRoom: async (room) => {
      const idx = mockRooms.findIndex(r => r.id === room.id)
      if (idx !== -1) {
        mockRooms[idx] = room
      } else {
        mockRooms.push(room)
      }
      return room
    }
  }

  const pbMock = {
    collection: () => ({
      getFirstListItem: async () => null,
      update: async () => ({}),
      create: async () => ({}),
      delete: async () => ({})
    }),
    files: {
      getURL: (record, filename) => `http://localhost/files/${record.id}/${filename}`
    }
  }

  const mockUtils = {
    $time: {
      getRelative: () => '1m'
    },
    $string: {
      truncate: (str) => str || ''
    },
    $func: {
      debounce: (fn) => (...args) => fn(...args)
    },
    $list: {
      createManager: ({ fetchNextBatch, render, Fuse }) => {
        let loadedItems = []
        let lastItem = null
        let hasMore = true

        const manager = {
          get loadedItems () {
            return loadedItems
          },
          set loadedItems (val) {
            loadedItems = val
          },
          get lastItem () {
            return lastItem
          },
          set lastItem (val) {
            lastItem = val
          },
          get hasMore () {
            return hasMore
          },
          set hasMore (val) {
            hasMore = val
          },
          fetch: async () => {
            const { items } = await fetchNextBatch(lastItem)
            if (items.length === 0) {
              hasMore = false
            } else {
              loadedItems = [...loadedItems, ...items]
              lastItem = items[items.length - 1]
            }
          },
          performRender: async () => {
            if (loadedItems.length === 0 && hasMore) {
              await manager.fetch()
            }
            let itemsToDisplay = loadedItems
            const query = (globalState.listSearchQuery || '').trim().toLowerCase()
            if (query && Fuse) {
              const fuseInstance = new Fuse(loadedItems, {
                keys: ['searchContent'],
                threshold: 0.4
              })
              itemsToDisplay = fuseInstance.search(query).map(r => r.item)
            }
            await render(itemsToDisplay, query)
          },
          reset: () => {
            loadedItems = []
            lastItem = null
            hasMore = true
          }
        }

        const debouncedRender = () => manager.performRender()
        const debouncedSaveScroll = () => {
        }

        return {
          manager,
          debouncedRender,
          debouncedSaveScroll
        }
      }
    }
  }

  // Simple mock Fuse constructor
  class MockFuse {
    constructor (list, options) {
      this.list = list
      this.options = options
    }
    search (query) {
      const q = query.toLowerCase()
      return this.list
        .filter(item => (item.searchContent || '').toLowerCase().includes(q))
        .map(item => ({ item }))
    }
  }

  beforeEach(async () => {
    document.body.innerHTML = ''
    emittedEvents.length = 0

    globalState.currentUser = {
      id: 'user1',
      name: 'User One'
    }
    globalState.currentAppView = 'chats'
    globalState.activeSelectionId = null
    globalState.activeSelectionType = null
    globalState.listSearchQuery = ''
    globalState.subscriptions = {}
    globalState.busListeners = {}

    mockRooms = [
      {
        id: 'room1',
        is_group: false,
        name: null,
        participants: [
          {
            id: 'user1',
            name: 'User One',
            last_read_message_id: 'm1'
          },
          {
            id: 'user2',
            name: 'Alice Smith',
            username: 'alice'
          }
        ],
        updated_at: '2025-01-01T10:00:00Z'
      },
      {
        id: 'room2',
        is_group: true,
        name: 'Project Discussion',
        participants: [
          {
            id: 'user1',
            name: 'User One',
            last_read_message_id: null
          },
          {
            id: 'user3',
            name: 'Bob Johnson',
            username: 'bob'
          }
        ],
        updated_at: '2025-01-01T09:00:00Z'
      }
    ]

    mockMessages = {
      room1: [
        {
          id: 'm1',
          room_id: 'room1',
          sender_id: 'user1',
          type: 'text',
          content: 'Hello Alice',
          created_at: '2025-01-01T10:00:00Z'
        }
      ],
      room2: [
        {
          id: 'm2',
          room_id: 'room2',
          sender_id: 'user3',
          type: 'text',
          content: 'Welcome Bob',
          created_at: '2025-01-01T09:00:00Z'
        }
      ]
    }

    if (!customElements.get('atoll-list')) {
      customElements.define('atoll-list', class extends HTMLElement {
      })
    }
    if (!customElements.get('atoll-profile')) {
      customElements.define('atoll-profile', class extends HTMLElement {
      })
    }
    if (!customElements.get('chat-list-item')) {
      customElements.define('chat-list-item', class extends HTMLElement {
        static get observedAttributes () {
          return ['room-id', 'room-name', 'preview-text', 'relative-time', 'is-unread', 'unread-count', 'is-group', 'user-role', 'is-muted']
        }
      })
    }

    const mocks = {
      globalStore: {
        $state: globalState
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
      },
      utils: mockUtils,
      fuse: {
        $Fuse: MockFuse
      },
      cryptoWorker: {
        $worker: {
          execute: async () => ({})
        }
      }
    }

    tagName = await loadComponent('chat-list', mocks)
  })

  test('should render empty state message when no chats exist', async () => {
    mockRooms = []
    mockMessages = {}

    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 50))

    const emptyMsg = el.querySelector('.text-body-secondary')
    assert.ok(emptyMsg, 'Empty message element should exist')
    assert.equal(emptyMsg.textContent, 'No chats found', 'Should display "No chats found"')
  })

  test('should render chat-list-item elements with accurate attributes', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 50))

    const items = el.querySelectorAll('chat-list-item')
    assert.equal(items.length, 2, 'Should render 2 chat list items')

    const firstItem = items[0]
    assert.equal(firstItem.getAttribute('room-id'), 'room1')
    assert.equal(firstItem.getAttribute('room-name'), 'Alice Smith')
    assert.equal(firstItem.getAttribute('preview-text'), 'You: Hello Alice')
    assert.equal(firstItem.getAttribute('is-unread'), 'false')

    const secondItem = items[1]
    assert.equal(secondItem.getAttribute('room-id'), 'room2')
    assert.equal(secondItem.getAttribute('room-name'), 'Project Discussion')
    assert.equal(secondItem.getAttribute('preview-text'), 'Bob: Welcome Bob')
    assert.equal(secondItem.getAttribute('is-unread'), 'true')
    assert.equal(secondItem.getAttribute('unread-count'), '1')

    const groupAvatar = secondItem.querySelector('atoll-profile[slot="avatar"]')
    assert.ok(groupAvatar, 'Group chat list item should contain an avatar profile element')
    assert.equal(groupAvatar.getAttribute('type'), 'multiparty', 'Group avatar should have type="multiparty"')
    assert.equal(groupAvatar.getAttribute('split-count'), '2', 'Group avatar split-count should equal 2 (minimum split count for 1 other participant)')
  })

  test('should filter list results on listSearchQuery update', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 50))

    globalState.trigger('listSearchQuery', 'Project')
    await new Promise(resolve => setTimeout(resolve, 50))

    const items = el.querySelectorAll('chat-list-item')
    assert.equal(items.length, 1, 'Should filter down to 1 matching item')
    assert.equal(items[0].getAttribute('room-name'), 'Project Discussion')

    // Search query with no match
    globalState.trigger('listSearchQuery', 'nonexistentqueryxyz')
    await new Promise(resolve => setTimeout(resolve, 50))

    const emptyMsg = el.querySelector('.text-body-secondary')
    assert.ok(emptyMsg, 'Should show empty message on unmatched search')
    assert.equal(emptyMsg.textContent, 'No matches found', 'Should display "No matches found"')
  })

  test('should selectively reorder on db:new_local_data and preserve order on metadata updates', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 50))

    let items = el.querySelectorAll('chat-list-item')
    assert.equal(items[0].getAttribute('room-id'), 'room1')
    assert.equal(items[1].getAttribute('room-id'), 'room2')

    // 1. Metadata update (room:read_state_changed) -> stays in place
    globalState.busListeners['room:read_state_changed']?.forEach(cb => cb('room2'))
    await new Promise(resolve => setTimeout(resolve, 50))

    items = el.querySelectorAll('chat-list-item')
    assert.equal(items[0].getAttribute('room-id'), 'room1', 'room1 should remain at position 0 on metadata update')
    assert.equal(items[1].getAttribute('room-id'), 'room2', 'room2 should remain at position 1 on metadata update')

    // 2. New message event (db:new_local_data) for room2 -> moves to top
    mockMessages.room2.push({
      id: 'm3',
      room_id: 'room2',
      sender_id: 'user3',
      type: 'text',
      content: 'New message in group',
      created_at: '2025-01-01T11:00:00Z'
    })

    for (const cb of (globalState.busListeners['db:new_local_data'] || [])) {
      await cb({ room_id: 'room2' })
    }
    await new Promise(resolve => setTimeout(resolve, 50))

    items = el.querySelectorAll('chat-list-item')
    assert.equal(items[0].getAttribute('room-id'), 'room2', 'room2 should be moved to top after new message event')
    assert.equal(items[1].getAttribute('room-id'), 'room1')
  })

  test('should restore empty state when rooms are deleted', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 50))

    mockRooms = []
    globalState.busListeners['db:room_deleted']?.forEach(cb => cb({ room_id: 'room1' }))
    globalState.busListeners['db:room_deleted']?.forEach(cb => cb({ room_id: 'room2' }))
    await new Promise(resolve => setTimeout(resolve, 50))

    const emptyMsg = el.querySelector('.text-body-secondary')
    assert.ok(emptyMsg, 'Should render empty state after deleting all rooms')
    assert.equal(emptyMsg.textContent, 'No chats found')
  })

  test('should mark conversation as read when activeSelectionId changes', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 50))

    // room2 is initially unread
    const room2 = mockRooms.find(r => r.id === 'room2')
    const meBefore = room2.participants.find(p => p.id === 'user1')
    assert.equal(meBefore.last_read_message_id, null, 'room2 should initially be unread')

    // Select room2 while in chats view
    globalState.activeSelectionId = 'room2'
    globalState.trigger('activeSelectionId', 'room2')
    await new Promise(resolve => setTimeout(resolve, 50))

    const meAfter = room2.participants.find(p => p.id === 'user1')
    assert.equal(meAfter.last_read_message_id, 'm2', 'room2 should be marked as read when selected')
  })
})
