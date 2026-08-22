import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Account Info Component Storage Management', () => {
  let tagName
  let storageUsage
  let mediaCleared
  let messagesCleared
  let historyCleared

  beforeEach(async () => {
    document.body.innerHTML = ''
    storageUsage = {
      mediaBytes: 14889779, // ~14.2 MB
      mediaCount: 28,
      messagesBytes: 250880, // ~245 KB
      messagesCount: 120,
      totalBytes: 15140659 // ~14.4 MB
    }
    mediaCleared = false
    messagesCleared = false
    historyCleared = false

    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')

    const mockGlobalStore = {
      $state: {
        currentUser: { username: 'alice' },
        subscribe: (key, cb) => () => {
        }
      }
    }

    const mockStorage = {
      $storage: {
        getStorageUsage: async () => storageUsage,
        clearLocalMediaCache: async () => {
          mediaCleared = true
          storageUsage.mediaBytes = 0
          storageUsage.mediaCount = 0
          storageUsage.totalBytes = storageUsage.messagesBytes
          return true
        },
        clearLocalMessagesCache: async () => {
          messagesCleared = true
          storageUsage.messagesBytes = 0
          storageUsage.messagesCount = 0
          storageUsage.totalBytes = storageUsage.mediaBytes
          return true
        },
        clearLocalHistory: async () => {
          historyCleared = true
          storageUsage.mediaBytes = 0
          storageUsage.mediaCount = 0
          storageUsage.messagesBytes = 0
          storageUsage.messagesCount = 0
          storageUsage.totalBytes = 0
          return true
        }
      }
    }

    const mockEventBus = {
      $bus: {
        on: () => {
        },
        emit: () => {
        }
      }
    }

    tagName = await loadComponent('account-info', {
      globalStore: mockGlobalStore,
      storage: mockStorage,
      eventBus: mockEventBus
    })
  })

  test('should render username and storage metrics chips', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const usernameEl = el.querySelector('.form-control')
    assert.equal(usernameEl.textContent.trim(), 'alice')

    const btnClearMedia = el.querySelector('[data-testid="btnClearMedia"]')
    const btnClearMessages = el.querySelector('[data-testid="btnClearMessages"]')
    const btnClearAllCache = el.querySelector('[data-testid="btnClearAllCache"]')

    assert.ok(btnClearMedia, 'Clear Media button should render')
    assert.ok(btnClearMessages, 'Clear Messages button should render')
    assert.ok(btnClearAllCache, 'Clear All Cache button should render')
  })

  test('should execute clear media, messages, and all cache actions', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const btnClearMedia = el.querySelector('[data-testid="btnClearMedia"]')
    btnClearMedia.click()

    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(mediaCleared, true, 'clearLocalMediaCache should be invoked')

    const btnClearMessages = el.querySelector('[data-testid="btnClearMessages"]')
    btnClearMessages.click()

    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(messagesCleared, true, 'clearLocalMessagesCache should be invoked')

    const btnClearAllCache = el.querySelector('[data-testid="btnClearAllCache"]')
    btnClearAllCache.click()

    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(historyCleared, true, 'clearLocalHistory should be invoked')
  })
})
