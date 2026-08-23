import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Passkey Settings Component', () => {
  let tagName

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    document.body.innerHTML = ''

    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    await loadComponent('atoll-input')
    await loadComponent('atoll-popup')
    await loadComponent('atoll-permission-modal', {
      pocketbase: {
        pb: {
          authStore: { model: { id: 'test-user-id', username: 'testuser' } }
        }
      },
      cryptoWorker: { $worker: { execute: async () => new Uint8Array([1, 2, 3]) } },
      biometric: { isAvailable: async () => true },
      eventBus: { $bus: { emit: () => {}, on: () => (() => {}) } },
      totp: Promise.resolve({ $totp: { verify: async () => true } })
    })

    const mockGlobalStore = {
      $state: {
        subscribe: (key, cb) => {
          return () => {}
        }
      }
    }

    const mockPocketbase = {
      pb: {
        authStore: {
          model: {
            id: 'test-user-id',
            totp_enabled: false
          }
        },
        collection: () => ({
          getOne: async () => ({
            id: 'test-user-id',
            username: 'testuser',
            totp_enabled: false
          })
        })
      }
    }

    const mockBiometric = {
      isAvailable: async () => true,
      storeMasterKey: async () => {},
      deleteMasterKey: async () => {}
    }

    tagName = await loadComponent('passkey-settings', {
      globalStore: mockGlobalStore,
      pocketbase: mockPocketbase,
      cryptoWorker: { $worker: {} },
      eventBus: { $bus: { emit: () => {} } },
      totp: Promise.resolve({ $totp: {} }),
      biometric: mockBiometric
    })
  })

  test('should render passkey-settings and support state update', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const btnManage = el.querySelector('[data-testid="btnManagePasskey"]')
    assert.ok(btnManage, 'Manage button should be rendered')

    const label = btnManage.querySelector('.atoll-btn-label')
    assert.ok(label, 'Label should exist inside the button')
    assert.equal(label.textContent.trim(), 'Enable Biometric Unlock')

    const statusEl = el.querySelector('.text-muted.small')
    assert.equal(statusEl.textContent.trim(), 'Disabled')
  })
})
