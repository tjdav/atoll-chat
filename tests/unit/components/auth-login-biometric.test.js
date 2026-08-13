import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Auth Login Biometric Integration', () => {
  let tagName

  beforeEach(async () => {
    document.body.innerHTML = ''
    localStorage.clear()

    const mockGlobalStore = {
      $state: {
        subscribe: (_key, _cb) => {
          return () => {
          }
        }
      }
    }

    const mockPocketbase = {
      pb: {
        baseUrl: '/',
        authStore: {
          model: null,
          isValid: false
        },
        buildURL: (path) => path
      }
    }

    const mockBiometric = {
      isAvailable: async () => true,
      retrieveMasterKey: async () => new Uint8Array(32)
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
        execute: async () => {
        }
      }
    }

    // Set mock biometric user in localStorage
    localStorage.setItem('atoll_biometric_users', JSON.stringify([
      {
        id: 'uid-alice',
        username: 'alice',
        avatar: ''
      }
    ]))

    tagName = await loadComponent('auth-login', {
      globalStore: mockGlobalStore,
      pocketbase: mockPocketbase,
      cryptoWorker: mockCryptoWorker,
      eventBus: mockEventBus,
      totp: Promise.resolve({ $totp: {} }),
      biometric: mockBiometric
    })
  })

  test('should display biometric sign in header and dynamic button when biometric users are enrolled', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    // Wait for hydration and rendering
    await new Promise((resolve) => setTimeout(resolve, 100))

    const bioSection = el.querySelector('[data-testid="biometricSection"]')
    assert.ok(bioSection, 'Biometric section should be rendered')
    assert.ok(!bioSection.classList.contains('d-none'), 'Biometric section should not be hidden')

    const headerSpan = bioSection.querySelector('span')
    assert.ok(headerSpan, 'Header title span should exist')
    assert.equal(headerSpan.textContent.trim(), 'Biometric Sign In', 'Header title should display "Biometric Sign In"')

    const bioContainer = el.querySelector('[data-testid="biometricContainer"]')
    assert.ok(bioContainer, 'Biometric container should exist')

    const bioBtn = bioContainer.querySelector('atoll-button')
    assert.ok(bioBtn, 'Biometric login button for @alice should be dynamically created')
  })
})
