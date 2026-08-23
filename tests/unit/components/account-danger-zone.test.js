import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Account Danger Zone Component', () => {
  let tagName
  let historyDeleted
  let accountDeleted

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    document.body.innerHTML = ''
    historyDeleted = false
    accountDeleted = false

    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    await loadComponent('atoll-input')
    await loadComponent('atoll-popup')
    await loadComponent('atoll-permission-modal', {
      pocketbase: {
        pb: {
          authStore: { model: { id: 'usr-1', username: 'alice' } }
        }
      },
      cryptoWorker: { $worker: { execute: async () => new Uint8Array([1, 2, 3]) } },
      biometric: { isAvailable: async () => false },
      eventBus: { $bus: { emit: () => {}, on: () => (() => {}) } },
      totp: Promise.resolve({ $totp: { verify: async () => true } })
    })

    const mockGlobalStore = {
      $state: {
        currentUser: {
          id: 'usr-1',
          username: 'alice'
        }
      }
    }

    const mockPocketbase = {
      pb: {
        authStore: {
          model: {
            id: 'usr-1',
            username: 'alice'
          },
          clear: () => {}
        },
        send: async (path, options) => {
          if (path === '/api/custom/history/delete') {
            if (options?.body?.password === 'secret123') {
              historyDeleted = true
              return {
                success: true,
                message: 'Message history deleted successfully.'
              }
            }
            throw new Error('Invalid password.')
          }
          if (path === '/api/custom/account/delete') {
            if (options?.body?.password === 'secret123') {
              accountDeleted = true
              return {
                success: true,
                message: 'Account deleted successfully.'
              }
            }
            throw new Error('Invalid password.')
          }
          return { success: false }
        }
      }
    }

    const mockStorage = {
      $storage: {
        clearLocalHistory: async () => true
      }
    }

    const mockCryptoWorker = {
      $worker: {
        execute: async () => ({ success: true })
      }
    }

    const mockBiometric = {
      deleteMasterKey: async () => true
    }

    const mockEventBus = {
      $bus: {
        emit: () => {},
        on: () => {}
      }
    }

    tagName = await loadComponent('account-danger-zone', {
      globalStore: mockGlobalStore,
      pocketbase: mockPocketbase,
      storage: mockStorage,
      cryptoWorker: mockCryptoWorker,
      biometric: mockBiometric,
      eventBus: mockEventBus
    })
  })

  test('should render danger zone buttons', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const btnHistory = el.querySelector('[data-testid="btnDeleteHistory"]')
    const btnAccount = el.querySelector('[data-testid="btnDeleteAccount"]')

    assert.ok(btnHistory, 'Delete History button should render')
    assert.ok(btnAccount, 'Delete Account button should render')
  })

  test('should handle history deletion via permission modal', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const permModal = el.querySelector('[data-testid="permissionModal"]')
    assert.ok(permModal, 'Permission modal element should exist')

    permModal.prompt = async () => ({
      success: true,
      method: 'password',
      keyB: 'secret123',
      password: 'secret123'
    })

    const btnHistory = el.querySelector('[data-testid="btnDeleteHistory"]')
    btnHistory.click()

    await new Promise((resolve) => setTimeout(resolve, 50))

    assert.equal(historyDeleted, true, 'history/delete API should be invoked successfully')
  })
})
