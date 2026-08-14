import { test } from 'node:test'
import assert from 'node:assert'
import { loadComponent } from '../helpers/load-component.js'

test('Atoll Bottom Navigation Component Tests', async (t) => {
  // Setup simulated environment mock state
  const mockState = {
    isAuthenticated: true,
    isVaultUnlocked: true,
    currentAppView: 'chats',
    currentUser: {
      id: 'test-user',
      username: 'tester'
    },
    activeSelectionId: null,
    subscribers: {},
    subscribe (key, cb) {
      if (!this.subscribers[key]) {
        this.subscribers[key] = []
      }
      this.subscribers[key].push(cb)
      cb(this[key])
      return () => {
        this.subscribers[key] = this.subscribers[key].filter(x => x !== cb)
      }
    },
    set (key, val) {
      this[key] = val
      if (this.subscribers[key]) {
        this.subscribers[key].forEach(cb => cb(val))
      }
    }
  }

  const mocks = {
    globalStore: {
      $state: mockState
    },
    bootstrap: Promise.resolve({
      Dropdown: class {
        constructor () {
        }
        show () {
        }
        hide () {
        }
      }
    }),
    storage: {
      $storage: {
        getAllRoomsSorted: async () => [],
        getLatestMessage: async () => null
      }
    }
  }

  await t.test('should mount bottom navigation with all expected tabs', async () => {
    const tagName = await loadComponent('atoll-bottom-navigation', mocks)
    const bottomNav = document.createElement(tagName)
    document.body.appendChild(bottomNav)

    // Wait for initial render cycle
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.ok(bottomNav, 'Component should instantiate successfully')

    const chatsBtn = bottomNav.querySelector('[data-testid="bottomBtnChats"]')
    assert.ok(chatsBtn, 'Chats direct tab should exist')

    const mediaBtn = bottomNav.querySelector('[data-testid="bottomBtnMedia"]')
    assert.ok(mediaBtn, 'Media tab trigger should exist')

    const filesBtn = bottomNav.querySelector('[data-testid="bottomBtnFiles"]')
    assert.ok(filesBtn, 'Files tab trigger should exist')

    const profileBtn = bottomNav.querySelector('[data-testid="bottomBtnProfile"]')
    assert.ok(profileBtn, 'Profile tab trigger should exist')

    bottomNav.remove()
  })

  await t.test('should update active class based on currentAppView state', async () => {
    const tagName = await loadComponent('atoll-bottom-navigation', mocks)
    const bottomNav = document.createElement(tagName)
    document.body.appendChild(bottomNav)

    // Wait for initial render cycle
    await new Promise(resolve => setTimeout(resolve, 50))

    const chatsBtn = bottomNav.querySelector('[data-testid="bottomBtnChats"]')
    assert.ok(chatsBtn.classList.contains('active'), 'Chats tab should have active class by default')

    // Simulate switching views
    mockState.set('currentAppView', 'pictures')
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.ok(!chatsBtn.classList.contains('active'), 'Chats tab should lose active class when currentAppView is pictures')

    const mediaBtn = bottomNav.querySelector('[data-testid="bottomBtnMedia"]')
    assert.ok(mediaBtn.classList.contains('active'), 'Media tab should acquire active class when currentAppView is pictures')

    bottomNav.remove()
  })

  await t.test('should hide only when a chat thread is open (activeSelectionType === chats)', async () => {
    const tagName = await loadComponent('atoll-bottom-navigation', mocks)
    const bottomNav = document.createElement(tagName)
    document.body.appendChild(bottomNav)

    // Wait for initial render cycle
    await new Promise(resolve => setTimeout(resolve, 50))

    const navEl = bottomNav.querySelector('.atoll-bottom-navigation')
    assert.ok(navEl, 'Navigation element should exist')

    // No active selection -> bar visible
    assert.equal(navEl.hasAttribute('hidden'), false, 'Bar should be visible when no thread is open')

    // Open a chat conversation thread -> bar automatically hides
    mockState.set('activeSelectionId', 'room-1')
    mockState.set('activeSelectionType', 'chats')
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(navEl.hasAttribute('hidden'), true, 'Bar should hide when a chat thread is open')

    // Non-chat detail view (e.g. picture viewer) -> bar stays visible
    mockState.set('activeSelectionType', 'pictures')
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(navEl.hasAttribute('hidden'), false, 'Bar should remain visible for non-chat detail views')

    // Closing the thread restores the bar
    mockState.set('activeSelectionId', null)
    mockState.set('activeSelectionType', null)
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(navEl.hasAttribute('hidden'), false, 'Bar should be visible again after closing the thread')

    bottomNav.remove()
  })
})
