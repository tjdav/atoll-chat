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

  test('should open mobile nav offcanvas on back button click regardless of source chat', async () => {
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

    await new Promise(resolve => setTimeout(resolve, 50))

    const openNavEmitted = emittedEvents.find(e => e.event === 'ui:open_mobile_nav')
    assert.ok(openNavEmitted, 'ui:open_mobile_nav should be emitted on click')
    assert.equal(sharedState.mediaViewerSourceChatRoomId, 'source-room-id', 'Source chat room ID should NOT be cleared by back button')
  })

  test('should hide close button by default if no source chat was stored', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const btnCloseInner = el.querySelector('[data-testid="viewerCloseBtn"]')
    assert.ok(btnCloseInner, 'Close button element should exist in DOM')
    const btnCloseHost = btnCloseInner.closest('atoll-button') || btnCloseInner
    assert.ok(btnCloseHost.hasAttribute('hidden') || btnCloseHost.style.display === 'none', 'Close button host should be hidden')
  })

  test('should show close button when source chat is present and activeSelectionType is pictures or videos', async () => {
    sharedState.mediaViewerSourceChatRoomId = 'source-room-id'
    sharedState.mediaViewerSourceMessageId = 'source-msg-uuid'
    sharedState.activeSelectionType = 'pictures'

    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const btnCloseInner = el.querySelector('[data-testid="viewerCloseBtn"]')
    assert.ok(btnCloseInner, 'Close button element should exist in DOM')
    const btnCloseHost = btnCloseInner.closest('atoll-button') || btnCloseInner
    assert.equal(btnCloseHost.hasAttribute('hidden'), false, 'Close button host should NOT be hidden')
  })

  test('should navigate back to source chat, set jump flags, and clear source variables when clicking close button', async () => {
    sharedState.mediaViewerSourceChatRoomId = 'source-room-id'
    sharedState.mediaViewerSourceMessageId = 'source-msg-uuid'

    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const btnClose = el.querySelector('[data-testid="viewerCloseBtn"]')
    assert.ok(btnClose, 'Close button should exist')
    btnClose.click()

    await new Promise(resolve => setTimeout(resolve, 150))

    assert.equal(sharedState.mediaViewerSourceChatRoomId, null, 'Source chat room ID should be cleared')
    assert.equal(sharedState.mediaViewerSourceMessageId, null, 'Source message ID should be cleared')
    assert.equal(sharedState.currentAppView, 'chats', 'App view should change to chats')
    assert.equal(sharedState.activeSelectionId, 'source-room-id', 'Active selection ID should change to source room ID')
    assert.equal(sharedState.activeSelectionType, 'chats', 'Active selection type should change to chats')
    assert.equal(sharedState.isJumpingToMessage, true, 'isJumpingToMessage flag should be set')
    assert.equal(sharedState.jumpToMessageId, 'source-msg-uuid', 'jumpToMessageId should be correct message ID')
  })

  test('should navigate back to source chat when pressing Escape key', async () => {
    sharedState.mediaViewerSourceChatRoomId = 'source-room-id'
    sharedState.mediaViewerSourceMessageId = 'source-msg-uuid'

    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    await new Promise(resolve => setTimeout(resolve, 150))

    assert.equal(sharedState.mediaViewerSourceChatRoomId, null, 'Source chat room ID should be cleared on Escape')
    assert.equal(sharedState.currentAppView, 'chats', 'App view should change to chats on Escape')
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
