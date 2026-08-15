import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Auth Register Invite Code Pre-Fill Component Tests', () => {
  let mockState
  let listeners
  let mockEventBus

  beforeEach(async () => {
    document.body.innerHTML = ''
    listeners = {}
    mockState = {
      pendingRegistrationInvite: null,
      authView: 'register'
    }
    mockEventBus = {
      $bus: {
        emit: (event, payload) => {
          if (listeners[event]) {
            listeners[event].forEach(cb => cb(payload))
          }
        },
        on: (event, callback) => {
          if (!listeners[event]) {
            listeners[event] = []
          }
          listeners[event].push(callback)
        },
        off: () => {
        }
      }
    }

    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    await loadComponent('atoll-input')
  })

  test('auth-register pre-fills invitation code from global state pendingRegistrationInvite', async () => {
    mockState.pendingRegistrationInvite = 'INV-SETUP-1234'

    const tagName = await loadComponent('auth-register', {
      globalStore: { $state: mockState },
      eventBus: mockEventBus
    })
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const inviteInput = el.querySelector('[data-testid="invitationCode"]') || el.querySelector('atoll-input[name="invitation_code"]')
    assert.ok(inviteInput, 'Invitation code input element should exist')
    assert.equal(inviteInput.value, 'INV-SETU-P123')
  })

  test('auth-register updates invitation code on auth:invite_code_received event', async () => {
    mockState.pendingRegistrationInvite = null

    const tagName = await loadComponent('auth-register', {
      globalStore: { $state: mockState },
      eventBus: mockEventBus
    })
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    mockEventBus.$bus.emit('auth:invite_code_received', { code: 'INV-TEST-9999' })

    await new Promise(resolve => setTimeout(resolve, 50))

    const inviteInput = el.querySelector('[data-testid="invitationCode"]') || el.querySelector('atoll-input[name="invitation_code"]')
    assert.ok(inviteInput, 'Invitation code input element should exist')
    assert.equal(inviteInput.value, 'INV-TEST-9999')
  })
})
