import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Permission Modal Component', () => {
  let tagName
  let mockWorkerExecute
  let mockBiometricRetrieve

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    document.body.innerHTML = ''

    mockWorkerExecute = async (method, params) => {
      if (method === 'worker:crypto_secretbox_open_easy') {
        if (params.key === 'master-key-123' || (params.key && params.key.byteLength === 32)) {
          if (params.ciphertext === 'encrypted_bio_creds') {
            return JSON.stringify({ keyB: 'derived-key-b-123', username: 'alice' })
          }
          return new Uint8Array([1, 2, 3])
        }
        return null
      }
      return null
    }

    mockBiometricRetrieve = async () => 'master-key-123'

    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    await loadComponent('atoll-input')
    await loadComponent('atoll-popup')

    const mockPocketbase = {
      pb: {
        authStore: {
          model: {
            id: 'usr-1',
            username: 'alice',
            totp_enabled: false,
            encrypted_master_keys: {
              ciphertext: 'valid_ct',
              nonce: 'valid_nonce'
            }
          }
        },
        collection: () => ({
          getOne: async () => ({
            id: 'usr-1',
            username: 'alice',
            totp_enabled: false,
            encrypted_master_keys: {
              ciphertext: 'valid_ct',
              nonce: 'valid_nonce'
            }
          })
        })
      }
    }

    const mockCryptoWorker = {
      $worker: {
        execute: (...args) => mockWorkerExecute(...args)
      }
    }

    const mockBiometric = {
      isAvailable: async () => true,
      retrieveMasterKey: (...args) => mockBiometricRetrieve(...args)
    }

    const mockEventBus = {
      $bus: {
        emit: () => {},
        on: () => (() => {})
      }
    }

    tagName = await loadComponent('atoll-permission-modal', {
      pocketbase: mockPocketbase,
      cryptoWorker: mockCryptoWorker,
      biometric: mockBiometric,
      eventBus: mockEventBus,
      totp: Promise.resolve({ $totp: { verify: async () => true } })
    })
  })

  test('should render permission modal host element', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    assert.ok(el, 'Permission modal element should render')
    assert.equal(typeof el.prompt, 'function', 'el.prompt should be exposed')
  })

  test('should resolve prompt with biometric credentials when biometric succeeds', async () => {
    localStorage.setItem('atoll_biometric_credentials_usr-1', JSON.stringify({
      ciphertext: 'encrypted_bio_creds',
      nonce: 'nonce_123'
    }))

    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const promptPromise = el.prompt({
      title: 'Confirm Operation',
      allowBiometric: true,
      autoBiometric: false
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    const btnBio = el.querySelector('[data-testid="btnBiometric"]')
    assert.ok(btnBio, 'Biometric button should be visible')

    const innerBtn = btnBio.querySelector('button') || btnBio
    innerBtn.click()

    const result = await promptPromise
    assert.ok(result, 'Result should not be null')
    assert.equal(result.success, true)
    assert.equal(result.method, 'biometric')
    assert.equal(result.keyB, 'derived-key-b-123')
    assert.equal(result.masterKey, 'master-key-123')
  })

  test('should return null when cancelled', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const promptPromise = el.prompt({
      title: 'Confirm Operation',
      allowBiometric: false
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    const secondaryBtn = el.querySelector('[ref$="secondaryBtn"]') || el.querySelector('.atoll-popup-actions button')
    if (secondaryBtn) {
      secondaryBtn.click()
    } else {
      el.hide()
    }

    const result = await promptPromise
    assert.equal(result, null, 'Cancelled prompt should resolve to null')
  })
})
