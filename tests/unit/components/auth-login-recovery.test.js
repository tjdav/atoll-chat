import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Auth Login Recovery Workflow', () => {
  let tagName
  let mockAuthApi

  beforeEach(async () => {
    document.body.innerHTML = ''
    localStorage.clear()

    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    await loadComponent('atoll-input')

    const mockGlobalStore = {
      $state: {
        subscribe: (_key, _cb) => {
          return () => {
          }
        }
      }
    }

    mockAuthApi = {
      recoverAccount: async (username) => {
        if (username === 'validuser') {
          return {
            user: {
              id: 'user123',
              username: 'validuser',
              recovery_wraps: [{
                salt: 'mockSalt',
                nonce: 'mockNonce',
                ciphertext: 'mockCt'
              }],
              encrypted_private_keys: { ciphertext: 'mockKey' },
              encrypted_master_keys: { ciphertext: 'mockMaster' }
            }
          }
        }
        throw new Error('Invalid or expired recovery code.')
      },
      rotatePassword: async () => {
        return {
          token: 'mockToken123',
          record: {
            id: 'user123',
            username: 'validuser'
          }
        }
      }
    }

    const mockPocketbase = {
      pb: {
        baseUrl: '/',
        authStore: {
          model: null,
          isValid: false,
          save: () => {
          }
        },
        buildURL: (path) => path,
        send: async () => ({})
      },
      auth: mockAuthApi
    }

    const mockBiometric = {
      isAvailable: async () => false
    }

    const mockEventBus = {
      $bus: {
        on: () => {
        },
        emit: () => {
        },
        off: () => {
        }
      }
    }

    const mockCryptoWorker = {
      $worker: {
        execute: async (type, payload) => {
          if (type === 'worker:decrypt_master_key_with_code') {
            if (payload.code === 'RC-1234-5678-9012-3456') {
              return {
                master_key: '00112233445566778899aabbccddeeff',
                auth_proof: 'mockAuthProof123'
              }
            }
            return null
          }
          if (type === 'worker:decrypt_vault') {
            return {
              box_public_key: 'pub',
              box_private_key: 'priv'
            }
          }
          if (type === 'worker:encrypt_master_key_with_kek') {
            return { ciphertext: 'newWrap' }
          }
          return null
        }
      }
    }

    const mockStorage = {
      $storage: {
        saveConfigs: async () => {
        }
      }
    }

    const mockRealtimeSync = {
      $sync: {
        startSubscriptions: async () => {
        }
      }
    }

    tagName = await loadComponent('auth-login', {
      globalStore: mockGlobalStore,
      pocketbase: mockPocketbase,
      storage: mockStorage,
      realtimeSync: mockRealtimeSync,
      cryptoWorker: mockCryptoWorker,
      eventBus: mockEventBus,
      biometric: mockBiometric
    })
  })

  test('should render "Forgot password? Recover with code" button on login view', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const btnShowRecovery = el.querySelector('[ref$="btnShowRecovery"]')
    assert.ok(btnShowRecovery, 'btnShowRecovery should be rendered')
    const textAttr = btnShowRecovery.getAttribute('text') || btnShowRecovery.textContent.trim()
    assert.ok(textAttr.includes('Forgot password? Recover with code'))
  })

  test('should switch to viewRecovery and prefill username when btnShowRecovery is clicked', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const usernameInput = el.querySelector('[ref$="identity"]')
    if (usernameInput) {
      usernameInput.value = 'john_doe'
      usernameInput.dispatchEvent(new Event('input', { bubbles: true }))
    }

    const btnShowRecovery = el.querySelector('[ref$="btnShowRecovery"]')
    const innerBtn = btnShowRecovery.querySelector('button') || btnShowRecovery
    innerBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const viewLogin = el.querySelector('[ref$="viewLogin"]')
    const viewRecovery = el.querySelector('[ref$="viewRecovery"]')

    assert.ok(viewLogin.classList.contains('d-none'), 'viewLogin should be hidden')
    assert.ok(!viewRecovery.classList.contains('d-none'), 'viewRecovery should be visible')

    const recoveryUsernameInput = el.querySelector('[ref$="recoveryUsername"]')
    assert.ok(recoveryUsernameInput, 'recoveryUsername input should exist')
    assert.equal(recoveryUsernameInput.value, 'john_doe', 'recoveryUsername should be prefilled from identity input')
  })

  test('should switch back to viewLogin and clear code when btnCancelRecovery is clicked', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const btnShowRecovery = el.querySelector('[ref$="btnShowRecovery"]')
    const innerShowBtn = btnShowRecovery.querySelector('button') || btnShowRecovery
    innerShowBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const recoveryCodeInput = el.querySelector('[ref$="recoveryCodeInput"]')
    recoveryCodeInput.value = 'RC-1234-5678-9012-3456'

    const btnCancelRecovery = el.querySelector('[ref$="btnCancelRecovery"]')
    const innerCancelBtn = btnCancelRecovery.querySelector('button') || btnCancelRecovery
    innerCancelBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const viewLogin = el.querySelector('[ref$="viewLogin"]')
    const viewRecovery = el.querySelector('[ref$="viewRecovery"]')

    assert.ok(!viewLogin.classList.contains('d-none'), 'viewLogin should be visible')
    assert.ok(viewRecovery.classList.contains('d-none'), 'viewRecovery should be hidden')
    assert.equal(recoveryCodeInput.value, '', 'recoveryCodeInput should be cleared on cancel')
  })

  test('should auto-format recoveryCodeInput values', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const recoveryCodeInput = el.querySelector('[ref$="recoveryCodeInput"]')

    recoveryCodeInput.value = '1234567890123456'
    recoveryCodeInput.dispatchEvent(new Event('input', { bubbles: true }))

    assert.equal(recoveryCodeInput.value, 'RC-1234-5678-9012-3456', 'Code should auto-format as RC-XXXX-XXXX-XXXX-XXXX')
  })
})
