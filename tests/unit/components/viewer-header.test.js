import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Viewer Header Component', () => {
  let tagName
  let emittedEvents
  let stateSubscribers

  const sharedState = {
    mediaViewerSourceChatRoomId: null,
    mediaViewerSourceMessageId: null,
    activeSelectionType: 'pictures',
    activeSelectionId: 'some-media-id',
    currentAppView: 'pictures',
    isJumpingToMessage: false,
    jumpToMessageId: null,
    subscribe: (key, cb) => {
      if (!stateSubscribers[key]) {
        stateSubscribers[key] = []
      }
      stateSubscribers[key].push(cb)
      return () => {
        const index = stateSubscribers[key].indexOf(cb)
        if (index !== -1) {
          stateSubscribers[key].splice(index, 1)
        }
      }
    }
  }

  const mockEventBus = {
    $bus: {
      emit: (event, payload) => {
        emittedEvents.push({
          event,
          payload
        })
      },
      on: () => {
      },
      off: () => {
      }
    }
  }

  const mockStorage = {
    $storage: {
      getAsset: async (id) => {
        return {
          id,
          room_id: 'test-room-id',
          message_id: 'test-message-uuid'
        }
      }
    }
  }

  beforeEach(async () => {
    document.body.innerHTML = ''
    emittedEvents = []
    stateSubscribers = {}

    // Reset shared state variables before each test
    sharedState.mediaViewerSourceChatRoomId = null
    sharedState.mediaViewerSourceMessageId = null
    sharedState.activeSelectionType = 'pictures'
    sharedState.activeSelectionId = 'some-media-id'
    sharedState.currentAppView = 'pictures'
    sharedState.isJumpingToMessage = false
    sharedState.jumpToMessageId = null

    // Load dependencies first
    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    await loadComponent('jump-to-chat', {
      globalStore: { $state: sharedState },
      storage: mockStorage,
      eventBus: mockEventBus
    })
    await loadComponent('ui-share-button', {
      globalStore: { $state: sharedState },
      storage: mockStorage,
      eventBus: mockEventBus
    })

    tagName = await loadComponent('viewer-header', {
      globalStore: { $state: sharedState },
      eventBus: mockEventBus,
      storage: mockStorage
    })
  })

  test('should open mobile nav offcanvas by default if no source chat was stored', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('title', 'Image Details')
    el.setAttribute('subtitle', 'test.png')
    el.setAttribute('icon', 'gallery')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const btnBack = el.querySelector('atoll-button')
    assert.ok(btnBack, 'Back button should exist')

    btnBack.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    const openNavEmitted = emittedEvents.find(e => e.event === 'ui:open_mobile_nav')
    assert.ok(openNavEmitted, 'ui:open_mobile_nav should be emitted on click')
  })

  test('should go back to source chat and trigger jump to scroll when click back if source chat was stored', async () => {
    sharedState.mediaViewerSourceChatRoomId = 'source-room-id'
    sharedState.mediaViewerSourceMessageId = 'source-msg-uuid'

    const el = document.createElement(tagName)
    el.setAttribute('title', 'Image Details')
    el.setAttribute('subtitle', 'test.png')
    el.setAttribute('icon', 'gallery')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const btnBack = el.querySelector('atoll-button')
    assert.ok(btnBack, 'Back button should exist')
    btnBack.click()

    await new Promise(resolve => setTimeout(resolve, 150))

    assert.equal(sharedState.mediaViewerSourceChatRoomId, null, 'Source chat room ID should be cleared')
    assert.equal(sharedState.mediaViewerSourceMessageId, null, 'Source message ID should be cleared')
    assert.equal(sharedState.currentAppView, 'chats', 'App view should change to chats')
    assert.equal(sharedState.activeSelectionId, 'source-room-id', 'Active selection ID should change to source room ID')
    assert.equal(sharedState.activeSelectionType, 'chats', 'Active selection type should change to chats')
    assert.equal(sharedState.isJumpingToMessage, true, 'isJumpingToMessage flag should be set')
    assert.equal(sharedState.jumpToMessageId, 'source-msg-uuid', 'jumpToMessageId should be correct message ID')

    const scrollEmitted = emittedEvents.find(e => e.event === 'message:scroll_to')
    assert.ok(scrollEmitted, 'message:scroll_to event should be emitted')
    assert.equal(scrollEmitted.payload.messageId, 'source-msg-uuid')
  })

  test('should clear source variables when navigating away from pictures/videos', async () => {
    sharedState.mediaViewerSourceChatRoomId = 'source-room-id'
    sharedState.mediaViewerSourceMessageId = 'source-msg-uuid'

    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    // Simulate change of activeSelectionType to music
    if (stateSubscribers['activeSelectionType']) {
      for (const cb of stateSubscribers['activeSelectionType']) {
        cb('music')
      }
    }

    assert.equal(sharedState.mediaViewerSourceChatRoomId, null, 'Source room ID should be cleared on navigation away')
    assert.equal(sharedState.mediaViewerSourceMessageId, null, 'Source message ID should be cleared on navigation away')
  })
})
