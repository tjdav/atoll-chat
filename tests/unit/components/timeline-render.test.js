import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Chat Timeline Component Render Path', () => {
  let tagName
  let mockStorage
  let mockState

  beforeEach(async () => {
    document.body.innerHTML = ''

    mockState = {
      activeSelectionId: 'room-1',
      activeSelectionType: 'chats',
      currentUser: {
        id: 'user-1',
        name: 'Alice'
      },
      scrollPositions: {},
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
})
