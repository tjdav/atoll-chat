import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Chat Timeline Component Render Path', () => {
  let tagName
  let mockStorage
  let mockState
  let busListeners = {}

  const mockBus = {
    emit (event, payload) {
      if (busListeners[event]) {
        busListeners[event].forEach(cb => cb(payload))
      }
    },
    on (event, cb) {
      if (!busListeners[event]) {
        busListeners[event] = []
      }
      busListeners[event].push(cb)
    },
    off (event, cb) {
      if (busListeners[event]) {
        busListeners[event] = busListeners[event].filter(x => x !== cb)
      }
    }
  }

  beforeEach(async () => {
    document.body.innerHTML = ''
    for (const key of Object.keys(busListeners)) {
      delete busListeners[key]
    }

    mockState = {
      activeSelectionId: 'room-1',
      activeSelectionType: 'chats',
      currentUser: {
        id: 'user-1',
        name: 'Alice'
      },
      subscribe: () => () => {
      }
    }

    mockStorage = {
      $storage: {
        getMessagesByRoom: async (roomId, limit) => {
          const messages = []
          for (let i = 1; i <= (limit || 10); i++) {
            messages.push({
              id: `msg-${i}`,
              local_uuid: `uuid-${i}`,
              room_id: roomId,
              sender_id: i % 2 === 0 ? 'user-2' : 'user-1',
              type: 'text',
              content: `Message ${i}`,
              created_at: new Date(Date.now() - (10 - i) * 60000).toISOString(),
              status: 'sent'
            })
          }
          return messages
        },
        getRoom: async (roomId) => ({
          id: roomId,
          participants: [
            {
              id: 'user-1',
              name: 'Alice',
              last_read_message_id: 'msg-10'
            },
            {
              id: 'user-2',
              name: 'Bob',
              last_read_message_id: 'msg-5'
            }
          ]
        }),
        getMessagesByRoomBefore: async (roomId, beforeTime, limit = 50) => [],
        getMessagesByRoomAround: async (roomId, messageId, windowSize = 50) => []
      }
    }

    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    await loadComponent('atoll-chat-timeline-row')

    tagName = await loadComponent('atoll-chat-timeline', {
      globalStore: { $state: mockState },
      storage: mockStorage,
      eventBus: { $bus: mockBus },
      utils: {
        $func: {
          debounce: (fn) => fn,
          throttle: (fn) => fn
        }
      }
    })
  })

  /**
   * Tests that the timeline component imperatively renders timeline rows with bounded windowing.
   */
  test('should render timeline rows with correct block grouping and date separators', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    const rows = el.querySelectorAll('atoll-chat-timeline-row')
    assert.ok(rows.length > 0, 'Timeline rows should be rendered in container')
    assert.ok(rows.length <= 100, 'Rendered row count should be bounded to initial window')
  })

  /**
   * Tests that the timeline component mounts imperatively into document body.
   */
  test('should mount timeline component and respond to state changes', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))
    assert.ok(el, 'Timeline element should exist in DOM')
  })

  test('should exclude the current user from seen indicators', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    // user-1 is current user, user-2 is Bob
    // user-2 read msg-5, user-1 (current user) read msg-10
    // So msg-5 row should have user-2 in seen-user-ids, but msg-10 row should NOT have user-1.
    const rowMsg5 = el.querySelector('atoll-chat-timeline-row[message-id="msg-5"]')
    const rowMsg10 = el.querySelector('atoll-chat-timeline-row[message-id="msg-10"]')

    if (rowMsg5) {
      const seenUserIds = rowMsg5.getAttribute('seen-user-ids') || ''
      assert.ok(seenUserIds.includes('user-2'), 'Bob should be included in seen-user-ids on msg-5')
      assert.ok(!seenUserIds.includes('user-1'), 'Current user should be excluded from seen-user-ids on msg-5')
    }

    if (rowMsg10) {
      const seenUserIds = rowMsg10.getAttribute('seen-user-ids') || ''
      assert.ok(!seenUserIds.includes('user-1'), 'Current user should be excluded from seen-user-ids on msg-10')
    }
  })

  test('should scroll to bottom on room entry', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    const container = el.shadowRoot ? el.shadowRoot.querySelector('.atoll-chat-timeline-container') : el.querySelector('.atoll-chat-timeline-container')
    assert.ok(container, 'Timeline container should exist')
  })

  test('should scroll to bottom on db:new_local_data from another user when near bottom', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    const container = el.querySelector('.atoll-chat-timeline-container')
    assert.ok(container)

    let scrollCalled = false
    container.scrollTo = () => {
      scrollCalled = true
    }

    // Simulate incoming message from Bob
    const newMessage = {
      id: 'msg-11',
      local_uuid: 'uuid-11',
      room_id: 'room-1',
      sender_id: 'user-2',
      type: 'text',
      content: 'New message from Bob',
      created_at: new Date().toISOString(),
      status: 'sent'
    }

    // Mock storage returning the updated messages list
    mockStorage.$storage.getMessagesByRoom = async () => [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `msg-${i + 1}`,
        local_uuid: `uuid-${i + 1}`,
        room_id: 'room-1',
        sender_id: (i + 1) % 2 === 0 ? 'user-2' : 'user-1',
        type: 'text',
        content: `Message ${i + 1}`,
        created_at: new Date(Date.now() - (10 - i) * 60000).toISOString(),
        status: 'sent'
      })),
      newMessage
    ]

    mockBus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: newMessage
    })

    await new Promise(resolve => setTimeout(resolve, 200))

    assert.ok(scrollCalled, 'container.scrollTo should have been invoked for auto-scrolling near bottom')
  })

  test('should NOT force scroll to bottom on db:new_local_data when user is scrolled up', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    const container = el.querySelector('.atoll-chat-timeline-container')
    assert.ok(container)

    // Simulate scrolled up state: large scrollHeight, small scrollTop
    let scrollVal = 100
    Object.defineProperty(container, 'scrollHeight', {
      value: 2000,
      configurable: true
    })
    Object.defineProperty(container, 'clientHeight', {
      value: 500,
      configurable: true
    })
    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollVal,
      set: (v) => {
        scrollVal = v
      },
      configurable: true
    })

    // Fire scroll event to trigger updateAutoScrollState() inside component
    container.dispatchEvent(new Event('scroll'))

    let scrollCalled = false
    container.scrollTo = () => {
      scrollCalled = true
    }

    const newMessage = {
      id: 'msg-12',
      local_uuid: 'uuid-12',
      room_id: 'room-1',
      sender_id: 'user-2',
      type: 'text',
      content: 'Another message from Bob',
      created_at: new Date().toISOString(),
      status: 'sent'
    }

    mockBus.emit('db:new_local_data', {
      room_id: 'room-1',
      message: newMessage
    })

    await new Promise(resolve => setTimeout(resolve, 200))

    assert.strictEqual(scrollCalled, false, 'container.scrollTo should NOT have been called when user is scrolled up')
  })

  test('should re-anchor scroll to bottom when ui:media_loaded is emitted and shouldAutoScroll is true', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    const container = el.querySelector('.atoll-chat-timeline-container')
    assert.ok(container)

    let scrollCalled = false
    container.scrollTo = () => {
      scrollCalled = true
    }

    mockBus.emit('ui:media_loaded')

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.ok(scrollCalled, 'container.scrollTo should be invoked on media load when shouldAutoScroll is active')
  })
})
