import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Jump to Chat Component', () => {
  let tagName
  let emittedEvents

  // Persistent singleton objects across tests in the same suite
  const sharedState = {
    mediaViewerSourceChatRoomId: null,
    mediaViewerSourceMessageId: null,
    activeSelectionType: null,
    activeSelectionId: null,
    currentAppView: 'pictures',
    isJumpingToMessage: false,
    jumpToMessageId: null
  }

  const mockStorage = {
    $storage: {
      getAsset: async (id) => {
        if (id === 'asset-123') {
          return {
            id: 'asset-123',
            room_id: 'room-asset-123',
            message_id: 'msg-asset-123'
          }
        }
        return null
      },
      getMessage: async (id) => {
        if (id === 'link-msg-123') {
          return {
            id: 'link-msg-123',
            room_id: 'room-link-123'
          }
        }
        if (id === 'fallback-msg-123') {
          return {
            id: 'fallback-msg-123',
            room_id: 'room-fallback-123'
          }
        }
        return null
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

  beforeEach(async () => {
    document.body.innerHTML = ''
    emittedEvents = []

    // Mutate the persistent shared state properties in-place
    sharedState.mediaViewerSourceChatRoomId = null
    sharedState.mediaViewerSourceMessageId = null
    sharedState.activeSelectionType = null
    sharedState.activeSelectionId = null
    sharedState.currentAppView = 'pictures'
    sharedState.isJumpingToMessage = false
    sharedState.jumpToMessageId = null

    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')

    tagName = await loadComponent('jump-to-chat', {
      globalStore: { $state: sharedState },
      storage: mockStorage,
      eventBus: mockEventBus
    })
  })

  test('should render button with default attributes and labels', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const btn = el.querySelector('atoll-button')
    assert.ok(btn, 'atoll-button element should exist')
    assert.equal(btn.getAttribute('text'), 'Jump to Chat')
    assert.equal(btn.getAttribute('aria-label'), 'Jump to Chat')
    assert.equal(btn.getAttribute('title'), 'Jump to Chat')
    assert.equal(btn.getAttribute('variant'), 'primary')
    assert.equal(btn.getAttribute('size'), 'md')
    assert.equal(btn.getAttribute('leading-icon'), 'chat')
  })

  test('Tier 1: Resolution via explicit component attributes (room-id and message-id)', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('room-id', 'attr-room-1')
    el.setAttribute('message-id', 'attr-msg-1')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    let customEventDetail = null
    el.addEventListener('jump-to-chat:success', (e) => {
      customEventDetail = e.detail
    })

    const btn = el.querySelector('atoll-button')
    btn.click()

    await new Promise(resolve => setTimeout(resolve, 150))

    assert.equal(sharedState.currentAppView, 'chats')
    assert.equal(sharedState.activeSelectionId, 'attr-room-1')
    assert.equal(sharedState.activeSelectionType, 'chats')
    assert.equal(sharedState.isJumpingToMessage, true)
    assert.equal(sharedState.jumpToMessageId, 'attr-msg-1')

    assert.deepEqual(customEventDetail, {
      roomId: 'attr-room-1',
      messageId: 'attr-msg-1'
    })

    const scrollEmitted = emittedEvents.find(e => e.event === 'message:scroll_to')
    assert.ok(scrollEmitted, 'message:scroll_to should be emitted')
    assert.equal(scrollEmitted.payload.messageId, 'attr-msg-1')
  })

  test('Tier 2: Resolution via global navigation cache state', async () => {
    sharedState.mediaViewerSourceChatRoomId = 'cache-room-1'
    sharedState.mediaViewerSourceMessageId = 'cache-msg-1'

    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const btn = el.querySelector('atoll-button')
    btn.click()

    await new Promise(resolve => setTimeout(resolve, 150))

    assert.equal(sharedState.mediaViewerSourceChatRoomId, null, 'Cache room should be cleared')
    assert.equal(sharedState.mediaViewerSourceMessageId, null, 'Cache message should be cleared')
    assert.equal(sharedState.activeSelectionId, 'cache-room-1')
    assert.equal(sharedState.jumpToMessageId, 'cache-msg-1')
  })

  test('Tier 3: Resolution via $storage.getAsset for media types', async () => {
    sharedState.activeSelectionId = 'asset-123'
    sharedState.activeSelectionType = 'pictures'

    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const btn = el.querySelector('atoll-button')
    btn.click()

    await new Promise(resolve => setTimeout(resolve, 150))

    assert.equal(sharedState.activeSelectionId, 'room-asset-123')
    assert.equal(sharedState.jumpToMessageId, 'msg-asset-123')
  })

  test('Tier 3: Resolution via $storage.getMessage for links', async () => {
    sharedState.activeSelectionId = 'link-msg-123'
    sharedState.activeSelectionType = 'links'

    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const btn = el.querySelector('atoll-button')
    btn.click()

    await new Promise(resolve => setTimeout(resolve, 150))

    assert.equal(sharedState.activeSelectionId, 'room-link-123')
    assert.equal(sharedState.jumpToMessageId, 'link-msg-123')
  })

  test('Tier 3: Fallback to $storage.getMessage when asset is not found', async () => {
    sharedState.activeSelectionId = 'fallback-msg-123'
    sharedState.activeSelectionType = 'documents'

    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const btn = el.querySelector('atoll-button')
    btn.click()

    await new Promise(resolve => setTimeout(resolve, 150))

    assert.equal(sharedState.activeSelectionId, 'room-fallback-123')
    assert.equal(sharedState.jumpToMessageId, 'fallback-msg-123')
  })

  test('Warning toast when no active selection is present', async () => {
    sharedState.activeSelectionId = null
    sharedState.activeSelectionType = null

    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const btn = el.querySelector('atoll-button')
    btn.click()

    await new Promise(resolve => setTimeout(resolve, 50))

    const toastEmitted = emittedEvents.find(e => e.event === 'ui:show_toast')
    assert.ok(toastEmitted, 'ui:show_toast should be emitted')
    assert.equal(toastEmitted.payload.message, 'No active media or message selected')
    assert.equal(toastEmitted.payload.type, 'warning')
  })

  test('Warning toast when target room or message cannot be resolved', async () => {
    sharedState.activeSelectionId = 'nonexistent-id'
    sharedState.activeSelectionType = 'pictures'

    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const btn = el.querySelector('atoll-button')
    btn.click()

    await new Promise(resolve => setTimeout(resolve, 100))

    const toastEmitted = emittedEvents.find(e => e.event === 'ui:show_toast')
    assert.ok(toastEmitted, 'ui:show_toast should be emitted')
    assert.equal(toastEmitted.payload.message, 'Could not locate original chat message')
    assert.equal(toastEmitted.payload.type, 'warning')
  })
})
