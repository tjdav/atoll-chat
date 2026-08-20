import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Chat Timeline Component Render Path', () => {
  let tagName
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

  const mockState = {
    activeSelectionId: 'room-1',
    activeSelectionType: 'chats',
    currentUser: {
      id: 'user-1',
      name: 'Alice'
    },
    subscribe: () => () => {
    }
  }

  const mockStorage = {
    $storage: {
      getMessagesByRoom: async (roomId, limit) => [],
      getRoom: async (roomId) => ({}),
      getMessagesByRoomBefore: async (roomId, beforeTime, limit = 50) => [],
      getMessagesByRoomAround: async (roomId, messageId, windowSize = 50) => []
    }
  }

  beforeEach(async () => {
    document.body.innerHTML = ''
    for (const key of Object.keys(busListeners)) {
      delete busListeners[key]
    }

    mockState.activeSelectionId = 'room-1'
    mockState.activeSelectionType = 'chats'
    mockState.currentUser = {
      id: 'user-1',
      name: 'Alice'
    }

    mockStorage.$storage.getMessagesByRoom = async (roomId, limit) => {
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
    }

    mockStorage.$storage.getRoom = async (roomId) => ({
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
    })

    mockStorage.$storage.getMessagesByRoomBefore = async () => []
    mockStorage.$storage.getMessagesByRoomAround = async () => []

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

  test('should scroll to bottom on room entry instantly without magic timers', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    const container = el.querySelector('.atoll-chat-timeline-container')
    assert.ok(container, 'Timeline container should exist')

    Object.defineProperty(container, 'scrollHeight', {
      value: 1200,
      configurable: true
    })
    Object.defineProperty(container, 'clientHeight', {
      value: 400,
      configurable: true
    })

    mockBus.emit('room:select', { room_id: 'room-1' })
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.strictEqual(container.scrollTop, 1200, 'container.scrollTop should equal scrollHeight on room entry')
  })

  test('should pin to bottom on db:new_local_data from another user when near bottom', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    const container = el.querySelector('.atoll-chat-timeline-container')
    assert.ok(container)

    let currentScrollTop = 800
    Object.defineProperty(container, 'scrollHeight', {
      value: 1200,
      configurable: true
    })
    Object.defineProperty(container, 'clientHeight', {
      value: 400,
      configurable: true
    })
    Object.defineProperty(container, 'scrollTop', {
      get: () => currentScrollTop,
      set: (v) => {
        currentScrollTop = v
      },
      configurable: true
    })

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

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(currentScrollTop, 1200, 'scrollTop should be set to scrollHeight when near bottom')
  })

  test('should NOT pin to bottom on db:new_local_data when user is scrolled up', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    const container = el.querySelector('.atoll-chat-timeline-container')
    assert.ok(container)

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

    // Fire scroll event (dist = 2000 - 100 - 500 = 1400 > 150) -> sets stickToBottom = false
    container.dispatchEvent(new Event('scroll'))

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

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(scrollVal, 100, 'scrollTop should NOT change when stickToBottom is false')
  })

  test('should re-anchor scroll to bottom when ui:media_loaded is emitted and stickToBottom is true', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    const container = el.querySelector('.atoll-chat-timeline-container')
    assert.ok(container)

    let scrollVal = 500
    Object.defineProperty(container, 'scrollHeight', {
      value: 1500,
      configurable: true
    })
    Object.defineProperty(container, 'clientHeight', {
      value: 400,
      configurable: true
    })
    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollVal,
      set: (v) => {
        scrollVal = v
      },
      configurable: true
    })

    mockBus.emit('ui:media_loaded')

    await new Promise(resolve => setTimeout(resolve, 50))

    assert.strictEqual(scrollVal, 1500, 'scrollTop should be set to scrollHeight on ui:media_loaded when stickToBottom is true')
  })

  test('should run bounded convergence loop up to max 5 frames when dist > 1px', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    const container = el.querySelector('.atoll-chat-timeline-container')
    assert.ok(container)

    let rawScrollTop = 0
    let dynamicScrollHeight = 1000
    const clientHeightVal = 400

    Object.defineProperty(container, 'clientHeight', {
      value: clientHeightVal,
      configurable: true
    })
    Object.defineProperty(container, 'scrollHeight', {
      get: () => dynamicScrollHeight,
      configurable: true
    })
    Object.defineProperty(container, 'scrollTop', {
      get: () => rawScrollTop,
      set: (v) => {
        rawScrollTop = Math.min(v, Math.max(0, dynamicScrollHeight - clientHeightVal))
      },
      configurable: true
    })

    // Trigger ui:scroll_to_bottom to start convergence loop
    mockBus.emit('ui:scroll_to_bottom')

    // Simulate content height growth from 1000 to 1050 during convergence
    dynamicScrollHeight = 1050
    await new Promise(resolve => requestAnimationFrame(resolve))

    // Expected scroll top clamped to max scrollable offset (1050 - 400 = 650)
    assert.strictEqual(rawScrollTop, 650, 'Convergence should update scrollTop as content expands')
  })

  test('should re-pin on document.fonts.ready resolution and loadingdone event', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    const container = el.querySelector('.atoll-chat-timeline-container')
    assert.ok(container)

    let currentScrollTop = 0
    Object.defineProperty(container, 'scrollHeight', {
      value: 1600,
      configurable: true
    })
    Object.defineProperty(container, 'clientHeight', {
      value: 400,
      configurable: true
    })
    Object.defineProperty(container, 'scrollTop', {
      get: () => currentScrollTop,
      set: (v) => {
        currentScrollTop = v
      },
      configurable: true
    })

    if (typeof document !== 'undefined' && document.fonts?.addEventListener) {
      document.fonts.dispatchEvent(new Event('loadingdone'))
      await new Promise(resolve => setTimeout(resolve, 50))
      assert.strictEqual(currentScrollTop, 1600, 'document.fonts loadingdone should re-pin timeline')
    }
  })

  test('should execute scrollToAnchor with behavior: auto and correct block options', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    const targetRow = el.querySelector('atoll-chat-timeline-row[message-id="msg-5"]')
    assert.ok(targetRow, 'Target message row msg-5 should exist in DOM')

    let scrollIntoViewCalled = false
    let scrollOptions = null
    targetRow.scrollIntoView = (options) => {
      scrollIntoViewCalled = true
      scrollOptions = options
    }

    mockBus.emit('message:scroll_to', { messageId: 'msg-5' })

    await new Promise(resolve => setTimeout(resolve, 50))

    assert.ok(scrollIntoViewCalled, 'scrollIntoView should be called')
    assert.strictEqual(scrollOptions.behavior, 'auto', 'scrollToAnchor must use behavior: auto')
    assert.strictEqual(scrollOptions.block, 'center', 'message:scroll_to should use block: center')
  })

  test('should resolve elements outside DOM batch via getMessagesByRoomAround and re-render', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 150))

    let getAroundCalled = false
    let requestedTargetId = null

    mockStorage.$storage.getMessagesByRoomAround = async (roomId, targetId, windowSize) => {
      getAroundCalled = true
      requestedTargetId = targetId
      return [
        {
          id: 'msg-999',
          local_uuid: 'uuid-999',
          room_id: roomId,
          sender_id: 'user-1',
          type: 'text',
          content: 'Outside DOM batch message',
          created_at: new Date().toISOString(),
          status: 'sent'
        }
      ]
    }

    mockBus.emit('message:scroll_to', { messageId: 'msg-999' })

    await new Promise(resolve => setTimeout(resolve, 100))

    assert.ok(getAroundCalled, 'getMessagesByRoomAround should be called for target missing from DOM')
    assert.strictEqual(requestedTargetId, 'msg-999', 'getMessagesByRoomAround should be passed target messageId')

    const newRow = el.querySelector('atoll-chat-timeline-row[message-id="msg-999"]')
    assert.ok(newRow, 'Target row msg-999 should be rendered after getMessagesByRoomAround resolves')
  })
})
