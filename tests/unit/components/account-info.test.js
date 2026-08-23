import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Account Info Component Storage Management', () => {
  let tagName
  let storageUsage
  let mediaCleared
  let voiceCleared
  let messagesCleared
  let historyCleared
  let emittedToast
  let pbSentPath
  let pbSentBody

  beforeEach(async () => {
    document.body.innerHTML = ''
    emittedToast = null
    pbSentPath = null
    pbSentBody = null

    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = () => 'blob:mock-export-url'
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      URL.revokeObjectURL = () => {}
    }
    storageUsage = {
      messagesBytes: 250880,
      messagesCount: 120,
      voiceBytes: 3984588,
      voiceCount: 15,
      mediaBytes: 10905190,
      mediaCount: 28,
      totalBytes: 15140658
    }
    mediaCleared = false
    voiceCleared = false
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

    const mockPocketBase = {
      pb: {
        authStore: { model: { id: 'usr_123', username: 'alice' } },
        send: async (path, opts) => {
          pbSentPath = path
          pbSentBody = opts?.body
          if (path === '/api/custom/account/export') {
            if (opts?.body?.password === 'WrongPass') {
              throw new Error('Invalid password.')
            }
            return {
              success: true,
              export_version: '1.0',
              exported_at: new Date().toISOString(),
              offline_export: false,
              data: {
                user_profile: { id: 'usr_123', username: 'alice', email: 'alice@example.com' },
                cryptographic_credentials: { public_box_key: 'box_key', public_sign_key: 'sign_key' },
                trust_and_governance: { tier: 'standard', invite_quota: 5 },
                rooms: [{ id: 'room_1', name: 'General' }],
                authored_messages: [{ id: 'msg_1', room_id: 'room_1', sender_id: 'usr_123' }],
                media_records: [],
                invitations: [],
                invite_requests: []
              }
            }
          }
          throw new Error('NotFound')
        }
      }
    }

    const mockStorage = {
      $storage: {
        getStorageUsage: async () => storageUsage,
        exportLocalData: async () => ({
          rooms: [{ id: 'room_1', name: 'General' }],
          messages: [{ id: 'msg_1', local_uuid: 'uuid_1', room_id: 'room_1', sender_id: 'usr_123', type: 'text', text: 'Hello' }],
          config: [{ key: 'soundNotificationsEnabled', value: true }],
          assets: []
        }),
        clearLocalMediaCache: async () => {
          mediaCleared = true
          storageUsage.mediaBytes = 0
          storageUsage.mediaCount = 0
          storageUsage.totalBytes = storageUsage.messagesBytes + storageUsage.voiceBytes
          return true
        },
        clearLocalVoiceCache: async () => {
          voiceCleared = true
          storageUsage.voiceBytes = 0
          storageUsage.voiceCount = 0
          storageUsage.totalBytes = storageUsage.messagesBytes + storageUsage.mediaBytes
          return true
        },
        clearLocalMessagesCache: async () => {
          messagesCleared = true
          storageUsage.messagesBytes = 0
          storageUsage.messagesCount = 0
          storageUsage.totalBytes = storageUsage.mediaBytes + storageUsage.voiceBytes
          return true
        },
        clearLocalHistory: async () => {
          historyCleared = true
          storageUsage.mediaBytes = 0
          storageUsage.mediaCount = 0
          storageUsage.voiceBytes = 0
          storageUsage.voiceCount = 0
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
        emit: (event, payload) => {
          if (event === 'ui:show_toast') {
            emittedToast = payload
          }
        }
      }
    }

    tagName = await loadComponent('account-info', {
      globalStore: mockGlobalStore,
      pocketbase: mockPocketBase,
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

    const btnExportData = el.querySelector('[data-testid="btnExportData"]')
    const btnClearMessages = el.querySelector('[data-testid="btnClearMessages"]')
    const btnClearVoice = el.querySelector('[data-testid="btnClearVoice"]')
    const btnClearMedia = el.querySelector('[data-testid="btnClearMedia"]')
    const btnClearAllCache = el.querySelector('[data-testid="btnClearAllCache"]')

    assert.ok(btnExportData, 'Export Data button should render')
    assert.ok(btnClearMessages, 'Clear Messages button should render')
    assert.ok(btnClearVoice, 'Clear Voice Notes button should render')
    assert.ok(btnClearMedia, 'Clear Media button should render')
    assert.ok(btnClearAllCache, 'Clear All Cache button should render')
  })

  test('should execute clear media, voice, messages, and all cache actions', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const btnClearVoice = el.querySelector('[data-testid="btnClearVoice"]')
    btnClearVoice.click()

    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(voiceCleared, true, 'clearLocalVoiceCache should be invoked')

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

  test('should prompt permission modal and compile online GDPR export on click', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const permissionModal = el.querySelector('[data-testid$="permissionModal"]')
    assert.ok(permissionModal, 'permission modal should exist')

    let promptOptions = null
    permissionModal.prompt = async (opts) => {
      promptOptions = opts
      return { success: true, keyB: 'VaultPassword123!' }
    }

    const btnExportData = el.querySelector('[data-testid$="btnExportData"]')
    btnExportData.click()

    await new Promise((resolve) => setTimeout(resolve, 100))

    assert.ok(promptOptions, 'permissionModal.prompt should be invoked')
    assert.equal(promptOptions.title, 'Export Account Data')
    assert.equal(pbSentPath, '/api/custom/account/export')
    assert.equal(pbSentBody.password, 'VaultPassword123!')
    assert.ok(emittedToast, 'success toast should be emitted')
    assert.equal(emittedToast.message, 'Account data exported successfully.')
  })

  test('should fall back gracefully to offline export when server export fails', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const permissionModal = el.querySelector('[data-testid$="permissionModal"]')
    permissionModal.prompt = async () => ({ success: true, password: 'WrongPass' })

    const btnExportData = el.querySelector('[data-testid$="btnExportData"]')
    btnExportData.click()

    await new Promise((resolve) => setTimeout(resolve, 100))

    assert.equal(pbSentPath, '/api/custom/account/export')
    assert.ok(emittedToast, 'success toast should still be emitted for offline export fallback')
    assert.equal(emittedToast.message, 'Account data exported successfully.')
  })

  test('should do nothing when permission modal is cancelled', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const permissionModal = el.querySelector('[data-testid$="permissionModal"]')
    permissionModal.prompt = async () => null

    const btnExportData = el.querySelector('[data-testid$="btnExportData"]')
    btnExportData.click()

    await new Promise((resolve) => setTimeout(resolve, 100))

    assert.equal(pbSentPath, null, 'pb.send should not be called')
  })
})
