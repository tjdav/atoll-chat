import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Auth ALTCHA Integration Component Tests', () => {
  beforeEach(async () => {
    document.body.innerHTML = ''
    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
  })

  test('auth-login configures altcha-widget with challenge and auto=onload before append', async () => {
    const tagName = await loadComponent('auth-login')
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const widget = el.querySelector('altcha-widget')
    assert.ok(widget, 'altcha-widget element should be rendered inside auth-login')
    assert.equal(widget.getAttribute('display'), 'invisible')
    assert.equal(widget.getAttribute('auto'), 'onload')
    assert.ok(widget.getAttribute('challenge'), 'challenge attribute should be set')
  })

  test('auth-register configures altcha-widget with challenge and auto=onload before append', async () => {
    const tagName = await loadComponent('auth-register')
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const widget = el.querySelector('altcha-widget')
    assert.ok(widget, 'altcha-widget element should be rendered inside auth-register')
    assert.equal(widget.getAttribute('display'), 'invisible')
    assert.equal(widget.getAttribute('auto'), 'onload')
    assert.ok(widget.getAttribute('challenge'), 'challenge attribute should be set')
  })

  test('auth-login safely handles error reset when altcha-widget is un-upgraded', async () => {
    const tagName = await loadComponent('auth-login')
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const widget = el.querySelector('altcha-widget')
    assert.ok(widget, 'altcha-widget should exist')
    assert.equal(typeof widget.reset, 'undefined', 'altcha-widget should be un-upgraded in test environment')

    const identityInput = el.querySelector('[ref$="identity"]') || el.querySelector('atoll-input[name="identity"]')
    const passwordInput = el.querySelector('[ref$="password"]') || el.querySelector('atoll-input[name="password"]')
    const form = el.querySelector('form')

    if (identityInput) identityInput.value = 'testuser'
    if (passwordInput) passwordInput.value = 'password123456'

    // Mock global fetch to return login failure
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 400 })

    try {
      assert.doesNotThrow(() => {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
      })
      await new Promise(resolve => setTimeout(resolve, 100))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('auth-register safely handles error reset when altcha-widget is un-upgraded', async () => {
    const tagName = await loadComponent('auth-register')
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const widget = el.querySelector('altcha-widget')
    assert.ok(widget, 'altcha-widget should exist')
    assert.equal(typeof widget.reset, 'undefined', 'altcha-widget should be un-upgraded in test environment')

    const form = el.querySelector('form')
    const usernameInput = el.querySelector('[ref$="username"]')
    const inviteInput = el.querySelector('[ref$="invitationCode"]')
    const passwordInput = el.querySelector('[ref$="password"]')
    const passwordConfirmInput = el.querySelector('[ref$="passwordConfirm"]')

    if (usernameInput) usernameInput.value = 'newuser'
    if (inviteInput) inviteInput.value = 'INV-1234-5678'
    if (passwordInput) passwordInput.value = 'password123456'
    if (passwordConfirmInput) passwordConfirmInput.value = 'password123456'

    // Mock global fetch to simulate failure on check-availability or register
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      if (String(url).includes('check-availability')) {
        return new Response(JSON.stringify({ usernameExists: false }))
      }
      return new Response(JSON.stringify({ error: 'Registration failed' }), { status: 400 })
    }

    try {
      assert.doesNotThrow(() => {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
      })
      await new Promise(resolve => setTimeout(resolve, 100))
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
