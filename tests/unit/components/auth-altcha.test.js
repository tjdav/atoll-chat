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
})
